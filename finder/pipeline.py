"""A search job: query image -> search engines -> candidate downloads -> verified, ranked results."""
from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np

from . import engines, fetch, imaging, match, panels
from .engines import Candidate

EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="analyze")
WORKERS = 6

DEFAULT_SETTINGS = {
    "saucenao_key": "",
    "use_yandex": True,
    "use_tineye": True,
    "use_saucenao": True,
    "second_round": True,
    "auto_mangadex": True,
    "max_checks": 60,
    "mangadex_languages": "",
    "save_folder": "",
}


def _poly_area(p) -> float:
    p = np.asarray(p, np.float64)
    x, y = p[:, 0], p[:, 1]
    return float(0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def _clean(o):
    """Turn numpy scalars/arrays into plain Python so results can be saved as JSON."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.ndarray):
        return _clean(o.tolist())
    return o


def _host(u: str) -> str:
    h = urlparse(u).netloc.lower()
    return h[4:] if h.startswith("www.") else h


def _sharpness_label(w: float | None) -> str:
    if w is None:
        return "unknown"
    if w <= 1.45:
        return "crisp"
    if w <= 1.9:
        return "slightly soft"
    return "soft"


class Job:
    def __init__(self, root: Path, client, settings: dict, job_id: str | None = None):
        self.root = root
        self.client = client
        self.settings = settings
        self.id = job_id or time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:5]
        self.dir = root / self.id
        self.created = time.time()
        self.status = "running"
        self.phase = "Starting"
        self.log: list[dict] = []
        self.engines: dict[str, dict] = {}
        self.counters = {"found": 0, "checked": 0, "matched": 0, "failed": 0, "skipped": 0}
        self.results: dict[str, dict] = {}
        self.identification: dict = {}
        self.mangadex: dict = {"state": "idle"}
        self.roi: list[float] | None = None
        self.query_info: dict = {}
        self.query_name = ""
        self._seen_urls: set[str] = set()
        self._seen_sha: dict[str, str] = {}
        self._queue: asyncio.PriorityQueue | None = None
        self._budgets: dict[str, int] = {}
        self._yandex_info: dict = {}
        self._seq = 0
        self._workers: list[asyncio.Task] = []
        self._query: imaging.Picture | None = None
        self._qf = self._qfm = None
        self._wq: float | None = None
        self._lock = asyncio.Lock()
        self.touched = time.time()

    # ------------------------------------------------------------------ setup

    def log_msg(self, msg: str):
        self.log.append({"t": round(time.time() - self.created, 1), "msg": msg})
        self.log = self.log[-200:]

    def prepare_query(self, data: bytes, name: str = ""):
        pic = imaging.decode(data)
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / "cands").mkdir(exist_ok=True)
        (self.dir / f"query{pic.ext}").write_bytes(data)
        (self.dir / "query_thumb.jpg").write_bytes(imaging.thumbnail_jpeg(
            pic.rgb if pic.rgb is not None else pic.gray, 320))
        (self.dir / "upload.jpg").write_bytes(imaging.upload_version(pic))
        self.query_name = name
        self._set_query(pic)
        self.query_info = {
            "width": pic.width, "height": pic.height, "format": pic.format, "bytes": len(data),
            "jpeg_quality": pic.jpeg_quality, "colored": pic.colored, "file": f"query{pic.ext}",
            "edge_width": self._wq, "name": name,
        }

    def _set_query(self, pic: imaging.Picture):
        self._query = pic
        self._qf = match.extract(pic.gray, match.QUERY_SIDE)
        self._qfm = match.mirror_features(pic.gray, match.QUERY_SIDE)
        self._wq = imaging.edge_width(self._roi_region(pic.gray))

    def _roi_region(self, gray):
        if not self.roi:
            return gray
        x0, y0, x1, y1 = [int(round(v)) for v in self.roi]
        return gray[max(0, y0):y1, max(0, x0):x1]

    async def ensure_query_loaded(self):
        if self._query is not None:
            return
        f = self.dir / self.query_info["file"]
        data = f.read_bytes()
        pic = await asyncio.get_running_loop().run_in_executor(EXECUTOR, imaging.decode, data)
        await asyncio.get_running_loop().run_in_executor(EXECUTOR, self._set_query, pic)

    # ------------------------------------------------------------------ queue

    def _start_workers(self):
        if self._queue is None:
            self._queue = asyncio.PriorityQueue()
        if not self._workers:
            self._workers = [asyncio.create_task(self._worker()) for _ in range(WORKERS)]

    def stop(self):
        for t in self._workers:
            t.cancel()
        self._workers = []

    def add_candidates(self, cands: list[Candidate], force: bool = False, round_key: str = "manual",
                       budget: int | None = None):
        q = self._query
        qmax = max(q.width, q.height) if q else 0
        if budget is not None:
            self._budgets[round_key] = budget
        added = 0
        for c in cands:
            for url in [c.url] + engines.upgrades(c.url):
                key = url.split("#")[0]
                if not url or key in self._seen_urls:
                    continue
                self._seen_urls.add(key)
                cc = c if url == c.url else Candidate(
                    url=url, engine=c.engine, page_url=c.page_url, title=c.title, size=None,
                    priority=max(0, c.priority - 1), note="Full-size version of a thumbnail", referer=c.referer)
                prio = cc.priority
                area = cc.size[0] * cc.size[1] if cc.size and cc.size[0] and cc.size[1] else 0
                if cc.size and cc.size[0] and qmax and max(cc.size) < 0.45 * qmax:
                    prio += 10  # smaller than what you already have: check last
                self._seq += 1
                self._queue.put_nowait((prio, -area, self._seq, force, round_key, cc))
                added += 1
        self.counters["found"] += added
        return added

    async def _worker(self):
        while True:
            prio, _, _, force, round_key, cand = await self._queue.get()
            try:
                if not force:
                    left = self._budgets.get(round_key, 0)
                    if left <= 0:
                        self.counters["skipped"] += 1
                        continue
                    self._budgets[round_key] = left - 1
                await self._process(cand)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                self.counters["failed"] += 1
                self.log_msg(f"Error checking {_host(cand.url)}: {type(e).__name__}: {e}")
            finally:
                self._queue.task_done()

    async def drain(self):
        if self._queue is not None:
            await self._queue.join()

    async def _process(self, cand: Candidate, data: bytes | None = None):
        self.counters["checked"] += 1
        if data is None:
            try:
                data = await fetch.fetch_image(self.client, cand)
            except fetch.FetchError as e:
                self.counters["failed"] += 1
                if cand.engine in ("You", "MangaDex"):
                    self.log_msg(f"Could not download {_host(cand.url)}: {e}")
                return None
        sha = hashlib.sha1(data).hexdigest()
        if sha in self._seen_sha:
            cid = self._seen_sha[sha]
            if cid and cid in self.results:
                self._add_source(self.results[cid], cand)
            return cid
        self._seen_sha[sha] = ""
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(EXECUTOR, self._analyze, data, cand)
        if res is None:
            if cand.engine in ("You", "MangaDex-check"):
                self.log_msg(f"{cand.title or _host(cand.url)}: not the same image")
            return None
        self._seen_sha[sha] = res["id"]
        async with self._lock:
            self.results[res["id"]] = res
            self.counters["matched"] = len(self.results)
        self.touched = time.time()
        return res["id"]

    def _add_source(self, r: dict, cand: Candidate):
        src = {"url": cand.url, "page_url": cand.page_url, "engine": cand.engine, "title": cand.title}
        if all(s["url"] != cand.url for s in r["sources"]):
            r["sources"].append(src)

    # ------------------------------------------------------------------ analysis (runs in a thread)

    def _analyze(self, data: bytes, cand: Candidate) -> dict | None:
        try:
            pic = imaging.decode(data)
        except imaging.NotAnImage:
            return None
        cf = match.extract(pic.gray, match.CAND_SIDE)
        m = match.find(self._query.gray, self._qf, self._qfm, pic.gray, cf)
        if m is None:
            return None
        cid = uuid.uuid4().hex[:10]
        (self.dir / "cands" / f"{cid}{pic.ext}").write_bytes(data)
        thumb_src = pic.rgb if pic.rgb is not None else pic.gray
        (self.dir / "cands" / f"{cid}_t.jpg").write_bytes(imaging.thumbnail_jpeg(thumb_src, 420))
        diff_share, diff_boxes = (0.0, [])
        if m.scale >= 0.3:
            diff_share, diff_boxes = match.differences(self._query.gray, pic.gray, m.M)
        r = {
            "id": cid,
            "url": cand.url, "page_url": cand.page_url, "title": cand.title, "engine": cand.engine,
            "note": cand.note, "domain": _host(cand.page_url or cand.url),
            "sources": [{"url": cand.url, "page_url": cand.page_url, "engine": cand.engine, "title": cand.title}],
            "width": pic.width, "height": pic.height, "format": pic.format, "bytes": len(data),
            "jpeg_quality": pic.jpeg_quality, "colored": pic.colored, "mirrored": m.mirrored,
            "scale": m.scale, "angle": m.angle, "ncc": m.ncc, "agree": m.agree, "inliers": m.inliers,
            "diff_share": diff_share, "diff_boxes": diff_boxes, "diff_reliable": m.scale >= 0.3,
            "M": m.M.tolist(), "file": f"cands/{cid}{pic.ext}", "thumb": f"cands/{cid}_t.jpg",
            "added": round(time.time() - self.created, 1),
        }
        self._metrics(r, pic)
        return r

    def _metrics(self, r: dict, pic: imaging.Picture):
        """Everything that depends on the region of interest (recomputed when it changes)."""
        M = np.array(r["M"], np.float64)
        qshape = self._query.gray.shape
        geo = match.geometry(M, qshape, pic.gray.shape, roi=self.roi)
        x0, y0, x1, y1 = [int(round(v)) for v in geo["roi_in_cand"]]
        region = pic.gray[y0:y1, x0:x1]
        wc = imaging.edge_width(region) if region.size >= 4000 else None
        detail = r["scale"] * (self._wq / wc) if (self._wq and wc) else r["scale"]
        crop, kind = panels.suggest_crop(pic.gray, geo["roi_in_cand"])
        rx0, ry0, rx1, ry1 = self.roi or (0, 0, qshape[1], qshape[0])
        roi_area = max(1.0, (rx1 - rx0) * (ry1 - ry0))
        crop_q = match.apply(match.invert(M), match.rect_poly(*crop))
        more = max(0.0, _poly_area(crop_q) / roi_area - 1.0) if geo["coverage"] > 0.97 else 0.0
        text_differs = None
        if r.get("diff_reliable"):
            hit = 0.0
            for bx in r["diff_boxes"]:
                ix = max(0.0, min(bx[2], rx1) - max(bx[0], rx0))
                iy = max(0.0, min(bx[3], ry1) - max(bx[1], ry0))
                hit += ix * iy
            text_differs = bool(r["diff_share"] >= 0.012 and (hit / roi_area >= 0.004 or not self.roi))
        r.update({
            "coverage": geo["coverage"], "extra": geo["extra"], "roi_in_cand": geo["roi_in_cand"],
            "edge_width": wc, "sharpness": _sharpness_label(wc), "detail": detail,
            "upscaled": bool(wc and wc >= 2.0 and r["scale"] >= 1.3),
            "crop": crop, "crop_kind": kind, "panel_px": [crop[2] - crop[0], crop[3] - crop[1]],
            "roi_px": [round((rx1 - rx0) * r["scale"]), round((ry1 - ry0) * r["scale"])],
            "more_visible": more, "text_differs": text_differs,
        })
        d = min(detail, 10.0)
        score = d * d * (geo["coverage"] ** 2) * (1 + 0.3 * min(more, 1.0))
        if pic.colored and not self._query.colored:
            score *= 0.6
        if r["mirrored"]:
            score *= 0.85
        r["score"] = score
        r.update(_clean({k: r[k] for k in r}))

    async def set_roi(self, roi):
        await self.ensure_query_loaded()
        if roi:
            qh, qw = self._query.gray.shape
            x0, y0, x1, y1 = roi
            x0, x1 = sorted((max(0.0, min(qw, x0)), max(0.0, min(qw, x1))))
            y0, y1 = sorted((max(0.0, min(qh, y0)), max(0.0, min(qh, y1))))
            roi = [x0, y0, x1, y1] if (x1 - x0) >= 8 and (y1 - y0) >= 8 else None
        self.roi = roi
        loop = asyncio.get_running_loop()
        self._wq = await loop.run_in_executor(EXECUTOR, imaging.edge_width, self._roi_region(self._query.gray))
        self.query_info["edge_width"] = self._wq

        def redo(r):
            pic = imaging.decode((self.dir / r["file"]).read_bytes())
            self._metrics(r, pic)

        await asyncio.gather(*[loop.run_in_executor(EXECUTOR, redo, r) for r in list(self.results.values())])
        self.save()

    # ------------------------------------------------------------------ the search itself

    async def run(self):
        self._start_workers()
        try:
            upload = (self.dir / "upload.jpg").read_bytes()
            self.phase = "Searching the web"
            tasks = []
            s = self.settings
            budget = int(s.get("max_checks", 60))
            if s.get("use_yandex", True):
                tasks.append(self._engine("Yandex", lambda: engines.yandex(self.client, upload), budget=budget))
            else:
                self.engines["Yandex"] = {"state": "off"}
            if s.get("use_tineye", True):
                tasks.append(self._engine("TinEye", lambda: engines.tineye(self.client, upload), budget=25))
            else:
                self.engines["TinEye"] = {"state": "off"}
            key = (s.get("saucenao_key") or "").strip()
            if s.get("use_saucenao", True) and key:
                tasks.append(self._engine("SauceNAO", lambda: engines.saucenao(self.client, upload, key)))
            else:
                self.engines["SauceNAO"] = {"state": "off", "error": "" if key else "Add a free API key in Settings"}
            await asyncio.gather(*tasks)
            self.phase = "Checking candidates"
            await self.drain()

            if s.get("second_round", True) and s.get("use_yandex", True):
                await self._second_round(max(25, budget * 2 // 3))
            self._identify()

            md = self.identification.get("md_chapter")
            if md and s.get("auto_mangadex", True):
                await self.mangadex_scan(chapter_id=md)
            self.phase = "Done"
            self.status = "done"
            self.log_msg(f"Finished: {len(self.results)} matching versions out of {self.counters['checked']} checked.")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            self.status = "error"
            self.phase = f"Something went wrong: {e}"
            self.log_msg(traceback.format_exc(limit=3))
        finally:
            self.save()

    async def _engine(self, name: str, make_coro, round_label: str = "", budget: int = 0):
        label = f"{name}{round_label}"
        self.engines[label] = {"state": "running"}
        t = time.time()
        try:
            cands, info = await make_coro()
            if not cands and name == "Yandex":  # Yandex occasionally answers empty; one retry
                await asyncio.sleep(2.5)
                cands, info = await make_coro()
            n = self.add_candidates(cands, round_key=label, budget=budget)
            self.engines[label] = {"state": "done", "found": len(cands), "new": n,
                                   "url": info.get("results_url", ""), "secs": round(time.time() - t, 1)}
            if name == "SauceNAO":
                self.engines[label]["remaining"] = info.get("remaining")
                self.identification["saucenao"] = info.get("hits", [])
            if name == "Yandex" and not round_label:
                self._yandex_info = info
            self.log_msg(f"{label}: {len(cands)} results")
        except engines.EngineError as e:
            self.engines[label] = {"state": "error", "error": str(e)}
            self.log_msg(f"{label}: {e}")
        except Exception as e:  # noqa: BLE001
            self.engines[label] = {"state": "error", "error": f"{type(e).__name__}: {e}"}
            self.log_msg(f"{label} failed: {type(e).__name__}: {e}")

    def _identify(self):
        hits = self.identification.get("saucenao") or []
        best = next((h for h in hits if h.get("title")), None)
        if best:
            ident = {"title": best["title"], "chapter": "", "part": best.get("part", ""),
                     "source": f"SauceNAO ({best['similarity']:.0f}% match, {best['index']})",
                     "links": best.get("links", [])}
            m = engines._CH_RE.search(best.get("part", "") or "")
            if m:
                ident["chapter"] = m.group(1)
            md = best.get("md_id")
            if md:
                ident["md_chapter"] = str(md)
            self.identification.update(ident)
            return
        # Only trust text attached to images we verified; similar-looking pages lie about chapters.
        texts = []
        for r in self.results.values():
            for s in r["sources"]:
                texts += [s.get("title", ""), unquote_safe(s.get("page_url", "")), unquote_safe(s.get("url", ""))]
        g = engines.guess_title_chapter(texts)
        if g:
            self.identification.update({"title": g["title"], "chapter": g["chapter"],
                                        "source": "guess from the pages where your image was found"})

    async def _second_round(self, budget: int):
        """Search again with the best full page / biggest version we verified."""
        rs = list(self.results.values())
        if not rs:
            return
        seeds = []
        ctx = [r for r in rs if r["more_visible"] >= 0.15 and r["coverage"] >= 0.9]
        if ctx:
            seeds.append(max(ctx, key=lambda r: (r["width"] * r["height"], r["score"])))
        best = max(rs, key=lambda r: r["score"])
        if best["detail"] >= 1.3 and best not in seeds:
            seeds.append(best)
        for i, seed in enumerate(seeds[:2]):
            self.phase = "Second search round"
            try:
                pic = imaging.decode((self.dir / seed["file"]).read_bytes())
            except Exception:  # noqa: BLE001
                continue
            up = imaging.upload_version(pic)
            self.log_msg(f"Searching again using the {seed['width']}x{seed['height']} version from {seed['domain']}")
            await self._engine("Yandex", lambda: engines.yandex(self.client, up),
                               round_label=f" (round {i + 2})", budget=budget)
            self.phase = "Checking candidates"
            await self.drain()

    # ------------------------------------------------------------------ manual additions

    async def add_manual(self, data: bytes | None = None, url: str = "") -> dict:
        await self.ensure_query_loaded()
        self._start_workers()
        cand = Candidate(url=url or "(your file)", engine="You", title="Added by you", priority=0)
        if data is None:
            try:
                data = await fetch.fetch_image(self.client, cand)
            except fetch.FetchError as e:
                return {"ok": False, "message": f"Could not download that image: {e}"}
        self._seen_urls.add(url)
        cid = await self._process(cand, data)
        self.save()
        if cid:
            return {"ok": True, "id": cid, "message": "It matches! Added to the results."}
        return {"ok": False, "message": "That image doesn't seem to contain your panel."}

    # ------------------------------------------------------------------ MangaDex

    async def mangadex_scan(self, title: str = "", chapter: str = "", chapter_id: str = "",
                            manga_id: str = ""):
        await self.ensure_query_loaded()
        self._start_workers()
        md = self.mangadex = {"state": "running", "message": "Looking up the chapter on MangaDex..."}
        try:
            if chapter_id:
                if chapter_id.isdigit():
                    chapter_id = await self._md_legacy(chapter_id)
                info = await engines.mangadex_chapter_info(self.client, chapter_id)
                manga_id, chapter = info["manga_id"], info["chapter"]
            if not manga_id:
                found = await engines.mangadex_find_manga(self.client, title)
                if not found:
                    md.update(state="done", message=f"MangaDex has no manga called '{title}'.")
                    return
                manga_id = found[0]["id"]
                md["manga"] = found[0]["title"]
            langs = [x.strip() for x in (self.settings.get("mangadex_languages") or "").split(",") if x.strip()]
            versions = await engines.mangadex_chapter_versions(self.client, manga_id, str(chapter), langs or None)
            if not versions:
                md.update(state="done", message=f"MangaDex has no readable versions of chapter {chapter}.")
                return
            versions.sort(key=lambda v: (v["lang"] != "en", v["lang"] != "ja"))
            versions = versions[:12]
            md["message"] = f"Found {len(versions)} versions of chapter {chapter}; looking for your page..."
            md["versions"] = [{"lang": v["lang"], "group": v["group"], "state": "waiting"} for v in versions]
            anchor_idx = None
            for vi, v in enumerate(versions):
                pages = await engines.mangadex_pages(self.client, v["id"])
                n = len(pages["small"])
                if anchor_idx is None:
                    order = list(range(n))
                else:
                    order = sorted(range(n), key=lambda i: abs(i - anchor_idx))[:9]
                hit = await self._md_find(pages["small"], order)
                md["versions"][vi]["state"] = f"page {hit + 1}" if hit is not None else "not found"
                if hit is None:
                    continue
                if anchor_idx is None:
                    anchor_idx = hit
                self.add_candidates([Candidate(
                    url=pages["full"][hit], engine="MangaDex",
                    page_url=f"https://mangadex.org/chapter/{v['id']}/{hit + 1}",
                    title=f"MangaDex · {v['lang']} · {v['group']}", priority=0,
                    note=f"MangaDex chapter {v['chapter']} ({v['lang']}, {v['group']})")], force=True)
            await self.drain()
            found = sum(1 for v in md["versions"] if v["state"].startswith("page"))
            md.update(state="done", message=f"Checked {len(versions)} MangaDex versions; your page is in {found}.")
        except Exception as e:  # noqa: BLE001
            md.update(state="error", message=f"MangaDex lookup failed: {type(e).__name__}: {e}")
        finally:
            self.save()

    async def _md_legacy(self, legacy: str) -> str:
        r = await self.client.post(f"{engines.MD_API}/legacy/mapping",
                                   json={"type": "chapter", "ids": [int(legacy)]},
                                   headers={"User-Agent": engines.APP_UA})
        r.raise_for_status()
        return r.json()["data"][0]["attributes"]["newId"]

    async def _md_find(self, urls: list[str], order: list[int]) -> int | None:
        """Download small page previews in `order` until one contains the query."""
        loop = asyncio.get_running_loop()
        sem = asyncio.Semaphore(3)
        found: list[int] = []

        async def check(i):
            if found:
                return
            async with sem:
                if found:
                    return
                try:
                    data = await fetch.fetch_image(self.client, Candidate(url=urls[i], engine="MangaDex"))
                except fetch.FetchError:
                    return
                ok = await loop.run_in_executor(EXECUTOR, self._quick_match, data)
                if ok:
                    found.append(i)

        for start in range(0, len(order), 6):
            await asyncio.gather(*[check(i) for i in order[start:start + 6]])
            if found:
                return min(found, key=lambda i: order.index(i))
        return None

    def _quick_match(self, data: bytes) -> bool:
        try:
            pic = imaging.decode(data)
        except imaging.NotAnImage:
            return False
        cf = match.extract(pic.gray, match.CAND_SIDE)
        return match.find(self._query.gray, self._qf, self._qfm, pic.gray, cf) is not None

    # ------------------------------------------------------------------ output

    def picks(self) -> dict:
        rs = [r for r in self.results.values() if r["coverage"] >= 0.6] or list(self.results.values())
        out = {}
        if rs:
            best = max(rs, key=lambda r: r["score"])
            out["best"] = best["id"]
            same = [r for r in rs if r.get("text_differs") is False]
            if same:
                out["same_text"] = max(same, key=lambda r: r["score"])["id"]
            # "least cropped" must show clearly more than the best pick and still be reasonably sharp
            floor = max(1.0, 0.5 * best["detail"])
            more = [r for r in rs if r["detail"] >= floor and r["more_visible"] >= max(0.05, best["more_visible"] + 0.08)]
            if more:
                out["complete"] = max(more, key=lambda r: (round(r["more_visible"] * 20), r["score"]))["id"]
        return out

    def state(self, full: bool = True) -> dict:
        rs = sorted(self.results.values(), key=lambda r: -r["score"])
        d = {
            "id": self.id, "status": self.status, "phase": self.phase, "created": self.created,
            "query": self.query_info, "roi": self.roi, "engines": self.engines, "counters": self.counters,
            "identification": {k: v for k, v in self.identification.items() if k != "saucenao"},
            "saucenao": self.identification.get("saucenao", []),
            "mangadex": self.mangadex, "picks": self.picks(),
        }
        if full:
            d["results"] = [{k: v for k, v in r.items() if k != "M"} for r in rs]
            d["log"] = self.log[-60:]
        else:
            d["count"] = len(rs)
            d["best"] = ({"width": rs[0]["width"], "height": rs[0]["height"], "detail": rs[0]["detail"]}
                         if rs else None)
        return _clean(d)

    def save(self):
        try:
            data = {
                "id": self.id, "created": self.created, "status": self.status if self.status != "running" else "done",
                "query_info": self.query_info, "roi": self.roi, "engines": self.engines,
                "counters": self.counters, "identification": self.identification, "mangadex": self.mangadex,
                "results": list(self.results.values()), "log": self.log[-60:],
                "seen_sha": self._seen_sha,
            }
            tmp = self.dir / "job.json.tmp"
            tmp.write_text(json.dumps(_clean(data)), encoding="utf-8")
            tmp.replace(self.dir / "job.json")
        except Exception:  # noqa: BLE001
            traceback.print_exc()

    @classmethod
    def load(cls, root: Path, job_id: str, client, settings: dict) -> "Job":
        d = json.loads((root / job_id / "job.json").read_text(encoding="utf-8"))
        j = cls(root, client, settings, job_id=job_id)
        j.created = d["created"]
        j.status = "done" if d.get("status") == "running" else d.get("status", "done")
        j.phase = "Done"
        j.query_info = d["query_info"]
        j.roi = d.get("roi")
        j.engines = d.get("engines", {})
        j.counters = d.get("counters", j.counters)
        j.identification = d.get("identification", {})
        j.mangadex = d.get("mangadex", {"state": "idle"})
        if j.mangadex.get("state") == "running":
            j.mangadex = {"state": "idle"}
        j.results = {r["id"]: r for r in d.get("results", [])}
        j.log = d.get("log", [])
        j._seen_sha = d.get("seen_sha", {})
        j._seen_urls = {s["url"] for r in j.results.values() for s in r["sources"]}
        return j

    # ------------------------------------------------------------------ images for the UI

    def aligned_png(self, cid: str) -> bytes:
        """The candidate warped onto the query (for the before/after slider)."""
        r = self.results[cid]
        cache = self.dir / "cands" / f"{cid}_aligned.png"
        if cache.exists():
            return cache.read_bytes()
        pic = imaging.decode((self.dir / r["file"]).read_bytes())
        M = np.array(r["M"], np.float64)
        qh, qw = self.query_info["height"], self.query_info["width"]
        out_scale = min(max(1.0, r["scale"]), 3.0)
        while qh * qw * out_scale * out_scale > 14_000_000 and out_scale > 1:
            out_scale *= 0.9
        src = pic.rgb if pic.rgb is not None else pic.gray
        warped, mask = match.render_in_query_frame(src, M, (qh, qw), out_scale, fill=200,
                                                   interp=cv2.INTER_CUBIC)
        if warped.ndim == 2:
            warped = np.where(mask, warped, 200).astype(np.uint8)
        data = imaging.encode_png(warped)
        cache.write_bytes(data)
        return data

    def crop_image(self, cid: str, box, flip: bool = False) -> tuple[bytes, str]:
        r = self.results[cid]
        pic = imaging.decode((self.dir / r["file"]).read_bytes())
        src = pic.rgb if pic.rgb is not None else pic.gray
        H, W = src.shape[:2]
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        x0, x1 = sorted((max(0, min(W, x0)), max(0, min(W, x1))))
        y0, y1 = sorted((max(0, min(H, y0)), max(0, min(H, y1))))
        if x1 - x0 < 2 or y1 - y0 < 2:
            raise ValueError("crop is empty")
        out = src[y0:y1, x0:x1]
        if flip:
            out = cv2.flip(out, 1)
        return imaging.encode_png(np.ascontiguousarray(out)), f"{x1 - x0}x{y1 - y0}"

    def delete_files(self):
        self.stop()
        shutil.rmtree(self.dir, ignore_errors=True)


def unquote_safe(u: str) -> str:
    from urllib.parse import unquote
    try:
        return unquote(u)
    except Exception:  # noqa: BLE001
        return u
