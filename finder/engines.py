"""Reverse image search engines and other sources of candidate images."""
from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/141.0.0.0 Safari/537.36")
APP_UA = "MangaPanelFinder/1.0 (personal reverse-image tool)"


class EngineError(Exception):
    pass


@dataclass
class Candidate:
    url: str                                  # direct image URL
    engine: str                               # where it came from
    page_url: str = ""
    title: str = ""
    size: tuple[int, int] | None = None       # size reported by the engine
    priority: int = 5                         # lower is fetched first
    note: str = ""
    referer: str = ""
    extra: dict = field(default_factory=dict)


def _clean_page_url(u: str) -> str:
    if not u:
        return ""
    p = urlparse(u)
    q = [(k, v) for k, v in parse_qs(p.query, keep_blank_values=True).items() if not k.startswith("utm_")]
    query = urlencode([(k, x) for k, vs in q for x in vs])
    return urlunparse(p._replace(query=query))


def _parse_size(text: str):
    m = re.search(r"(\d+)\s*[x×х]\s*(\d+)", text or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


# ---------------------------------------------------------------------------------- Yandex

def _yandex_state(page: str):
    m = re.search(r'id="ImagesApp-[^"]*"[^>]*?data-state="([^"]+)"', page)
    if not m:
        m = re.search(r'data-state="(\{&quot;initialState[^"]+)"', page)
    if not m:
        return None
    try:
        return json.loads(html.unescape(m.group(1)))
    except ValueError:
        return None


async def yandex(client: httpx.AsyncClient, data: bytes) -> tuple[list[Candidate], dict]:
    r = await client.post(
        "https://yandex.com/images/search",
        params={"rpt": "imageview", "cbir_page": "sites"},
        data={"prg": "1"},
        files={"upfile": ("image.jpg", data, "image/jpeg")},
        headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"},
        timeout=45,
    )
    page = r.text
    if "showcaptcha" in str(r.url) or "SmartCaptcha" in page or "captcha" in str(r.url):
        raise EngineError("Yandex wants a captcha right now. Try again in a while, or use the "
                          "'Open in Yandex' button.")
    st = _yandex_state(page)
    if not st:
        raise EngineError(f"Could not read Yandex results (HTTP {r.status_code}); the page format may have changed.")
    ini = st.get("initialState", {})
    out: list[Candidate] = []

    groups = (ini.get("cbirOtherSizes") or {}).get("items") or {}
    prio = {"large_dups": 0, "medium_dups": 1, "small_dups": 4}
    label = {"large_dups": "bigger copy", "medium_dups": "similar-size copy", "small_dups": "smaller copy"}
    for group, items in groups.items():
        for it in items or []:
            if it.get("url"):
                out.append(Candidate(url=it["url"], engine="Yandex", size=_parse_size(it.get("text", "")),
                                     priority=prio.get(group, 3), note=f"Yandex: {label.get(group, group)}"))

    for site in (ini.get("cbirSites") or {}).get("sites") or []:
        oi = site.get("originalImage") or {}
        if not oi.get("url"):
            continue
        size = (oi.get("width"), oi.get("height")) if oi.get("width") else None
        out.append(Candidate(url=oi["url"], engine="Yandex", page_url=_clean_page_url(site.get("url", "")),
                             title=site.get("title", ""), size=size, priority=2,
                             note="Yandex: page with this image"))

    for th in (ini.get("cbirSimilar") or {}).get("thumbs") or []:
        q = parse_qs(urlparse(th.get("linkUrl", "")).query)
        img = (q.get("img_url") or [""])[0]
        if img:
            out.append(Candidate(url=img, engine="Yandex", title=th.get("title", ""), priority=6,
                                 note="Yandex: similar image"))

    tags = [t.get("text", "") for t in (ini.get("cbirTags") or {}).get("tags") or []][:6]
    titles = [s.get("title", "") for s in (ini.get("cbirSites") or {}).get("sites") or []][:30]
    return out, {"results_url": str(r.url), "tags": tags, "titles": titles}


# ---------------------------------------------------------------------------------- TinEye

async def tineye(client: httpx.AsyncClient, data: bytes) -> tuple[list[Candidate], dict]:
    r = await client.post(
        "https://tineye.com/api/v1/result_json/",
        data={"sort": "size", "order": "desc"},
        files={"image": ("image.jpg", data, "image/jpeg")},
        headers={"User-Agent": UA, "Accept": "application/json"},
        timeout=45,
    )
    try:
        j = r.json()
    except ValueError as e:
        raise EngineError(f"TinEye answered with something unexpected (HTTP {r.status_code}).") from e
    out = []
    for m in j.get("matches") or []:
        size = (m.get("width"), m.get("height")) if m.get("width") else None
        for bl in (m.get("backlinks") or [])[:2]:
            if bl.get("url"):
                out.append(Candidate(url=bl["url"], engine="TinEye", page_url=bl.get("backlink", ""),
                                     size=size, priority=1, note="TinEye match"))
    key = (j.get("query") or {}).get("key")
    return out, {"results_url": f"https://tineye.com/search/{key}?sort=size&order=desc" if key else ""}


# ---------------------------------------------------------------------------------- SauceNAO

async def saucenao(client: httpx.AsyncClient, data: bytes, api_key: str) -> tuple[list[Candidate], dict]:
    r = await client.post(
        "https://saucenao.com/search.php",
        params={"output_type": 2, "api_key": api_key, "numres": 10, "db": 999},
        files={"file": ("image.jpg", data, "image/jpeg")},
        headers={"User-Agent": APP_UA},
        timeout=45,
    )
    if r.status_code == 403:
        raise EngineError("SauceNAO rejected the API key (check it in Settings).")
    if r.status_code == 429:
        raise EngineError("SauceNAO search limit reached for now (free keys allow ~100 searches a day).")
    try:
        j = r.json()
    except ValueError as e:
        raise EngineError(f"SauceNAO answered with something unexpected (HTTP {r.status_code}).") from e
    hits = []
    for res in j.get("results") or []:
        h, d = res.get("header", {}), res.get("data", {})
        sim = float(h.get("similarity", 0))
        if sim < 55:
            continue
        hits.append({
            "similarity": sim,
            "index": h.get("index_name", ""),
            "title": d.get("source") or d.get("title") or d.get("eng_name") or d.get("material") or "",
            "part": (d.get("part") or "").strip(" -"),
            "author": d.get("author") or d.get("artist") or d.get("creator") or "",
            "links": d.get("ext_urls") or [],
            "md_id": d.get("md_id"),
            "thumbnail": h.get("thumbnail", ""),
        })
    hdr = j.get("header", {})
    return [], {"hits": hits, "remaining": hdr.get("long_remaining"), "results_url": ""}


# ---------------------------------------------------------------------------------- guessing a title

_CH_RE = re.compile(r"(?:chapter|chap|ch\.?|cap[ií]tulo|глава|chapitre|kapitel|episode|ep\.?)\s*[-_#: ]?\s*(\d+(?:\.\d+)?)", re.I)
_STOP = re.compile(r"\b(read|online|manga|manhwa|raw|free|english|eng|scan|scans|page|chapter|chap|ch|"
                   r"vol|volume|hd|high quality|mangadex|in|the|for|and)\b", re.I)


def guess_title_chapter(texts: list[str]) -> dict:
    """Very rough 'what manga is this' guess from result titles and URLs."""
    chapters: dict[str, int] = {}
    names: dict[str, int] = {}
    for t in texts:
        if not t:
            continue
        t = re.sub(r"%20|[_+]", " ", t)
        m = _CH_RE.search(t)
        if not m:
            continue
        chapters[m.group(1).lstrip("0") or "0"] = chapters.get(m.group(1).lstrip("0") or "0", 0) + 1
        before = t[: m.start()]
        before = re.split(r"[|/\\:·•–—]", before)[-1] if re.search(r"[|/\\]", before) else before
        name = _STOP.sub(" ", before)
        name = re.sub(r"[^\w' ]+", " ", name)
        name = re.sub(r"\s+", " ", name).strip(" -").strip()
        if 2 <= len(name) <= 60:
            key = name.lower()
            names[key] = names.get(key, 0) + 1
    if not names:
        return {}

    def latin(s: str) -> bool:
        letters = [c for c in s if c.isalpha()]
        return bool(letters) and sum(c.isascii() for c in letters) / len(letters) > 0.8

    pool = {k: v for k, v in names.items() if latin(k)} or names  # prefer a Latin-script title
    name = max(pool, key=pool.get)
    ch = max(chapters, key=chapters.get) if chapters else ""
    return {"title": name.title(), "chapter": ch, "votes": pool[name]}


# ---------------------------------------------------------------------------------- thumbnail -> original

_RULES = [
    # Pinterest thumbnails -> originals
    (re.compile(r"^(https?://i\.pinimg\.com)/(?:\d+x\d*|\d+x)/(.+)$"), [r"\1/originals/\2"]),
    # Twitter / X
    (re.compile(r"^(https?://pbs\.twimg\.com/media/[^?:]+?)(?:\.(jpg|png|webp))?(?::\w+)?(?:\?.*)?$"),
     [r"\1?format=png&name=orig", r"\1?format=jpg&name=orig"]),
    # Fandom / Wikia scaled thumbnails
    (re.compile(r"^(https?://static\.wikia\.nocookie\.net/.+?/revision/latest)/(?:scale-to-width-down|scale-to-height-down|"
                r"smart|top-crop|zoom-crop|thumbnail|fixed-aspect-ratio-down)[^?]*(\?.*)?$"), [r"\1\2"]),
    # Blogger / Googleusercontent sized variants
    (re.compile(r"^(https?://[^/]*(?:googleusercontent|bp\.blogspot)\.com/.+?)/(?:s|w|h)\d+[^/]*/([^/]+)$"), [r"\1/s0/\2"]),
    (re.compile(r"^(https?://[^/]*googleusercontent\.com/[^=]+)=[swh]\d+[^/]*$"), [r"\1=s0"]),
    # WordPress resized copies and Jetpack CDN
    (re.compile(r"^(https?://.+?)-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))(\?.*)?$", re.I), [r"\1\2"]),
    (re.compile(r"^https?://i\d\.wp\.com/([^?]+)(\?.*)?$"), [r"https://\1"]),
    (re.compile(r"^(https?://[^?]+/wp-content/uploads/[^?]+)\?.+$"), [r"\1"]),
    # Reddit previews
    (re.compile(r"^https?://preview\.redd\.it/([^?]+)(\?.*)?$"), [r"https://i.redd.it/\1"]),
    # Imgur thumbnail suffixes (s, b, t, m, l, h)
    (re.compile(r"^(https?://i\.imgur\.com/)([A-Za-z0-9]{7})[sbtmlh](\.\w+)$"), [r"\1\2\3"]),
    (re.compile(r"^(https?://i\.imgur\.com/)([A-Za-z0-9]{5})[sbtmlh](\.\w+)$"), [r"\1\2\3"]),
    # eBay listing photos
    (re.compile(r"^(https?://i\.ebayimg\.com/.+/)s-l\d+(\.\w+)$"), [r"\1s-l1600\2"]),
    # Tumblr
    (re.compile(r"^(https?://\d+\.media\.tumblr\.com/.+/)s\d+x\d+(/.+)$"), [r"\1s2048x3072\2"]),
    (re.compile(r"^(https?://\d+\.media\.tumblr\.com/.+_)(?:\d{2,3})(\.\w+)$"), [r"\g<1>1280\2"]),
    # MangaDex data-saver -> full quality is a different file name, handled by the MangaDex source
]


def upgrades(url: str) -> list[str]:
    out = []
    for rx, reps in _RULES:
        if rx.match(url):
            for rep in reps:
                u = rx.sub(rep, url)
                if u != url and u not in out:
                    out.append(u)
    return out


# ---------------------------------------------------------------------------------- MangaDex

MD_API = "https://api.mangadex.org"


async def mangadex_find_manga(client: httpx.AsyncClient, title: str) -> list[dict]:
    r = await client.get(f"{MD_API}/manga", params={
        "title": title, "limit": 5, "order[relevance]": "desc",
        "contentRating[]": ["safe", "suggestive", "erotica"]},
        headers={"User-Agent": APP_UA}, timeout=30)
    r.raise_for_status()
    out = []
    for m in r.json().get("data", []):
        a = m["attributes"]
        name = (a.get("title") or {}).get("en") or next(iter((a.get("title") or {}).values()), "?")
        out.append({"id": m["id"], "title": name, "year": a.get("year"),
                    "languages": a.get("availableTranslatedLanguages") or []})
    return out


async def mangadex_chapter_versions(client: httpx.AsyncClient, manga_id: str, chapter: str,
                                    languages: list[str] | None = None) -> list[dict]:
    params = {"manga": manga_id, "chapter": chapter, "limit": 60, "includes[]": "scanlation_group",
              "includeExternalUrl": 0, "includeEmptyPages": 0,
              "contentRating[]": ["safe", "suggestive", "erotica", "pornographic"]}
    if languages:
        params["translatedLanguage[]"] = languages
    r = await client.get(f"{MD_API}/chapter", params=params, headers={"User-Agent": APP_UA}, timeout=30)
    r.raise_for_status()
    out = []
    for ch in r.json().get("data", []):
        a = ch["attributes"]
        if a.get("externalUrl") or not a.get("pages"):
            continue
        groups = [rel.get("attributes", {}).get("name", "") for rel in ch.get("relationships", [])
                  if rel.get("type") == "scanlation_group"]
        out.append({"id": ch["id"], "lang": a.get("translatedLanguage", "?"), "pages": a.get("pages"),
                    "group": ", ".join(g for g in groups if g) or "no group", "volume": a.get("volume"),
                    "chapter": a.get("chapter")})
    return out


async def mangadex_chapter_info(client: httpx.AsyncClient, chapter_id: str) -> dict:
    r = await client.get(f"{MD_API}/chapter/{chapter_id}", headers={"User-Agent": APP_UA}, timeout=30)
    r.raise_for_status()
    d = r.json()["data"]
    manga = next((rel["id"] for rel in d["relationships"] if rel["type"] == "manga"), None)
    return {"manga_id": manga, "chapter": d["attributes"].get("chapter")}


async def mangadex_pages(client: httpx.AsyncClient, chapter_id: str) -> dict:
    r = await client.get(f"{MD_API}/at-home/server/{chapter_id}", headers={"User-Agent": APP_UA}, timeout=30)
    r.raise_for_status()
    j = r.json()
    base, ch = j["baseUrl"], j["chapter"]
    return {
        "full": [f"{base}/data/{ch['hash']}/{f}" for f in ch["data"]],
        "small": [f"{base}/data-saver/{ch['hash']}/{f}" for f in ch["dataSaver"]],
    }
