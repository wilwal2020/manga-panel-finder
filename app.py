"""Manga Panel Finder - local web app.

Run with:  python app.py            (opens your browser)
           python app.py --no-browser --port 8765
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import socket
import sys
import threading
import time
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from finder import imaging
from finder.pipeline import DEFAULT_SETTINGS, Job

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
JOBS = DATA / "jobs"
SETTINGS_FILE = DATA / "settings.json"
KEEP_JOBS = 40
APP_ID = "manga-panel-finder"

jobs: dict[str, Job] = {}
state: dict = {}


def load_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    try:
        s.update(json.loads(SETTINGS_FILE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    return s


def save_settings(s: dict):
    DATA.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(s, indent=2), encoding="utf-8")


def prune_jobs():
    if not JOBS.exists():
        return
    dirs = sorted([d for d in JOBS.iterdir() if d.is_dir()], key=lambda d: d.name, reverse=True)
    for d in dirs[KEEP_JOBS:]:
        import shutil
        shutil.rmtree(d, ignore_errors=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    JOBS.mkdir(parents=True, exist_ok=True)
    prune_jobs()
    state["settings"] = load_settings()
    state["client"] = httpx.AsyncClient(
        follow_redirects=True, timeout=30,
        limits=httpx.Limits(max_connections=24, max_keepalive_connections=12),
    )
    yield
    for j in jobs.values():
        j.stop()
    await state["client"].aclose()


app = FastAPI(lifespan=lifespan, title="Manga Panel Finder")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


def get_job(job_id: str) -> Job:
    if not re.fullmatch(r"[\w-]{6,40}", job_id):
        raise HTTPException(404, "No such search")
    j = jobs.get(job_id)
    if j is None:
        if not (JOBS / job_id / "job.json").exists():
            raise HTTPException(404, "That search no longer exists")
        j = Job.load(JOBS, job_id, state["client"], state["settings"])
        jobs[job_id] = j
    return j


def get_result(j: Job, cid: str) -> dict:
    r = j.results.get(cid)
    if r is None:
        raise HTTPException(404, "No such result")
    return r


def safe_name(text: str) -> str:
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", text or "").strip(" .")
    return re.sub(r"\s+", " ", text)[:80] or "panel"


def base_filename(j: Job) -> str:
    ident = j.identification
    parts = []
    if ident.get("title"):
        parts.append(ident["title"])
        if ident.get("chapter"):
            parts.append(f"ch{ident['chapter']}")
    elif j.query_name:
        parts.append(Path(j.query_name).stem)
    return safe_name(" ".join(parts) or "panel")


# ------------------------------------------------------------------------------- pages

@app.get("/")
async def index():
    return FileResponse(ROOT / "static" / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/api/ping")
async def ping():
    return {"app": APP_ID}


# ------------------------------------------------------------------------------- searching

@app.post("/api/search")
async def start_search(file: UploadFile | None = File(None), url: str = Form("")):
    client = state["client"]
    name = ""
    if file is not None:
        data = await file.read()
        name = file.filename or ""
    elif url:
        from finder import fetch
        from finder.engines import Candidate
        try:
            data = await fetch.fetch_image(client, Candidate(url=url, engine="You"))
        except fetch.FetchError as e:
            raise HTTPException(400, f"Could not download that image: {e}")
        name = url.rsplit("/", 1)[-1].split("?")[0]
    else:
        raise HTTPException(400, "Give me an image file or an image link.")
    job = Job(JOBS, client, state["settings"])
    try:
        await asyncio.get_running_loop().run_in_executor(None, job.prepare_query, data, name)
    except imaging.NotAnImage as e:
        raise HTTPException(400, f"That doesn't look like an image I can read ({e}).")
    jobs[job.id] = job
    keep_task(asyncio.create_task(job.run()))
    prune_memory()
    return {"id": job.id}


_tasks: set = set()


def keep_task(t: asyncio.Task):
    """asyncio only keeps weak references to tasks; hold on to them until they finish."""
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


def prune_memory():
    """Keep finished searches from piling up in memory (they stay on disk)."""
    done = [j for j in jobs.values() if j.status != "running"]
    done.sort(key=lambda j: j.touched)
    for j in done[:-6]:
        j.stop()
        jobs.pop(j.id, None)


@app.get("/api/jobs")
async def list_jobs():
    out = []
    if JOBS.exists():
        for d in sorted(JOBS.iterdir(), key=lambda d: d.name, reverse=True):
            if d.name in jobs:
                out.append(jobs[d.name].state(full=False))
                continue
            f = d / "job.json"
            if not f.exists():
                continue
            try:
                jd = json.loads(f.read_text(encoding="utf-8"))
            except ValueError:
                continue
            rs = sorted(jd.get("results", []), key=lambda r: -r.get("score", 0))
            out.append({"id": jd["id"], "status": jd.get("status", "done"), "created": jd["created"],
                        "query": jd["query_info"], "identification": jd.get("identification", {}),
                        "count": len(rs),
                        "best": {"width": rs[0]["width"], "height": rs[0]["height"], "detail": rs[0]["detail"]}
                        if rs else None})
    return out


@app.get("/api/jobs/{job_id}")
async def job_state(job_id: str):
    return get_job(job_id).state()


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    j = get_job(job_id)
    jobs.pop(job_id, None)
    j.delete_files()
    return {"ok": True}


@app.delete("/api/jobs")
async def delete_all():
    for jid in [d.name for d in JOBS.iterdir() if d.is_dir()] if JOBS.exists() else []:
        if jid in jobs and jobs[jid].status == "running":
            continue
        try:
            get_job(jid).delete_files()
        except HTTPException:
            import shutil
            shutil.rmtree(JOBS / jid, ignore_errors=True)
        jobs.pop(jid, None)
    return {"ok": True}


@app.post("/api/jobs/{job_id}/add")
async def add_candidate(job_id: str, file: UploadFile | None = File(None), url: str = Form("")):
    j = get_job(job_id)
    if file is not None:
        return await j.add_manual(data=await file.read(), url="")
    if url:
        return await j.add_manual(url=url.strip())
    raise HTTPException(400, "Give me an image file or link.")


@app.post("/api/jobs/{job_id}/roi")
async def set_roi(job_id: str, request: Request):
    body = await request.json()
    j = get_job(job_id)
    await j.set_roi(body.get("roi"))
    return j.state()


@app.post("/api/jobs/{job_id}/sites")
@app.post("/api/jobs/{job_id}/mangadex")  # old name, kept for older pages
async def check_sites(job_id: str, request: Request):
    body = await request.json()
    j = get_job(job_id)
    title, chapter = (body.get("title") or "").strip(), str(body.get("chapter") or "").strip()
    if not title or not chapter:
        raise HTTPException(400, "Fill in both the manga title and the chapter number.")
    try:
        float(chapter)
    except ValueError:
        raise HTTPException(400, "The chapter should be a number, like 31 or 10.5.")
    if j.sites.get("state") == "running":
        return {"ok": True}
    j.sites = {"state": "running", "message": "Starting…", "rows": []}
    keep_task(asyncio.create_task(j.sites_scan(title=title, chapter=chapter)))
    return {"ok": True}


# ------------------------------------------------------------------------------- images

@app.get("/api/jobs/{job_id}/query")
async def query_file(job_id: str):
    j = get_job(job_id)
    return FileResponse(j.dir / j.query_info["file"])


@app.get("/api/jobs/{job_id}/query_thumb")
async def query_thumb(job_id: str):
    j = get_job(job_id)
    return FileResponse(j.dir / "query_thumb.jpg")


@app.get("/api/jobs/{job_id}/upload.jpg")
async def upload_copy(job_id: str):
    j = get_job(job_id)
    return FileResponse(j.dir / "upload.jpg", media_type="image/jpeg")


@app.get("/api/jobs/{job_id}/results/{cid}/thumb")
async def result_thumb(job_id: str, cid: str):
    j = get_job(job_id)
    r = get_result(j, cid)
    return FileResponse(j.dir / r["thumb"], headers={"Cache-Control": "max-age=86400"})


@app.get("/api/jobs/{job_id}/results/{cid}/file")
async def result_file(job_id: str, cid: str, dl: int = 0):
    j = get_job(job_id)
    r = get_result(j, cid)
    path = j.dir / r["file"]
    if dl:
        name = f"{base_filename(j)} - full {r['width']}x{r['height']}{path.suffix}"
        return FileResponse(path, filename=name)
    return FileResponse(path, headers={"Cache-Control": "max-age=86400"})


@app.get("/api/jobs/{job_id}/results/{cid}/aligned")
async def result_aligned(job_id: str, cid: str):
    j = get_job(job_id)
    get_result(j, cid)
    data = await asyncio.get_running_loop().run_in_executor(None, j.aligned_png, cid)
    return Response(data, media_type="image/png", headers={"Cache-Control": "max-age=86400"})


def _parse_box(box: str):
    try:
        vals = [float(v) for v in box.split(",")]
    except ValueError:
        raise HTTPException(400, "bad crop box")
    if len(vals) != 4:
        raise HTTPException(400, "bad crop box")
    return vals


@app.get("/api/jobs/{job_id}/results/{cid}/crop")
async def result_crop(job_id: str, cid: str, box: str, flip: int = 0):
    j = get_job(job_id)
    get_result(j, cid)
    try:
        data, size = await asyncio.get_running_loop().run_in_executor(None, j.crop_image, cid, _parse_box(box), bool(flip))
    except ValueError as e:
        raise HTTPException(400, str(e))
    name = f"{base_filename(j)} - panel {size}.png"
    return Response(data, media_type="image/png",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.post("/api/jobs/{job_id}/results/{cid}/save")
async def result_save(job_id: str, cid: str, request: Request):
    body = await request.json()
    j = get_job(job_id)
    r = get_result(j, cid)
    raw = (state["settings"].get("save_folder") or "").strip()
    folder = Path(raw)
    if not raw or not folder.is_absolute() or not folder.is_dir():
        raise HTTPException(400, "Pick an existing folder in Settings first (a full path like C:\\Users\\you\\Pictures).")
    if body.get("kind") == "full":
        src = j.dir / r["file"]
        name = f"{base_filename(j)} - full {r['width']}x{r['height']}{src.suffix}"
        data = src.read_bytes()
    else:
        data, size = await asyncio.get_running_loop().run_in_executor(
            None, j.crop_image, cid, body.get("box") or r["crop"], bool(body.get("flip")))
        name = f"{base_filename(j)} - panel {size}.png"
    target = folder / name
    n = 2
    while target.exists():
        target = folder / f"{Path(name).stem} ({n}){Path(name).suffix}"
        n += 1
    target.write_bytes(data)
    return {"ok": True, "path": str(target)}


# ------------------------------------------------------------------------------- settings

@app.get("/api/settings")
async def get_settings():
    return state["settings"]


@app.post("/api/settings")
async def post_settings(request: Request):
    body = await request.json()
    s = state["settings"]
    for k, default in DEFAULT_SETTINGS.items():
        if k in body:
            v = body[k]
            if isinstance(default, bool):
                v = bool(v)
            elif isinstance(default, int):
                try:
                    v = max(5, min(200, int(v)))
                except (TypeError, ValueError):
                    continue
            else:
                v = str(v).strip()
            s[k] = v
    if s.get("save_folder") and not (Path(s["save_folder"]).is_absolute() and Path(s["save_folder"]).is_dir()):
        return JSONResponse({"settings": s, "warning": "That save folder doesn't exist (use a full path like C:\\Users\\you\\Pictures)."})
    save_settings(s)
    return {"settings": s}


# ------------------------------------------------------------------------------- startup

def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def already_running(port: int) -> bool:
    try:
        r = httpx.get(f"http://127.0.0.1:{port}/api/ping", timeout=1.5)
        return r.json().get("app") == APP_ID
    except Exception:  # noqa: BLE001
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    port = args.port
    for p in range(args.port, args.port + 20):
        if port_free(p):
            port = p
            break
        if already_running(p):
            print(f"Manga Panel Finder is already running at http://127.0.0.1:{p}")
            if not args.no_browser:
                webbrowser.open(f"http://127.0.0.1:{p}")
            return
    url = f"http://127.0.0.1:{port}"
    print(f"\n  Manga Panel Finder is running at {url}\n  Keep this window open while you use it. Close it to stop.\n")
    if not args.no_browser:
        threading.Thread(target=lambda: (time.sleep(1.2), webbrowser.open(url)), daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    sys.exit(main())
