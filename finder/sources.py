"""Manga reading sites: find a chapter by title + number and list its page images.

Each source answers three questions:
    find_series(title)  -> [Series]        which series on the site is this manga?
    chapters(series)    -> {number: ref}   where is each chapter?
    pages(ref)          -> [image URLs]     the pages of one chapter, in reading order

The pipeline downloads those pages and checks which one contains your image, so a source
never has to know anything about the panel itself. To add a site, subclass Source.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass

import httpx

from .engines import UA


@dataclass
class Series:
    title: str
    ref: str          # whatever the source needs to list chapters (an id or a URL)
    url: str = ""


class SourceError(Exception):
    pass


def _norm_tokens(text: str) -> list[str]:
    text = html.unescape(text or "").lower().replace("’", "'")
    text = re.sub(r"'s\b", "", text)
    return [t for t in re.findall(r"[a-z0-9]+", text) if t not in {"the", "a", "of", "no", "wa", "na", "to"}]


COLOR_WORDS = {"color", "colored", "colour", "coloured", "colorized", "colourized"}


def title_score(query: str, candidate: str) -> float:
    """How well a site's series title matches the title we are looking for (0..1)."""
    q, c = set(_norm_tokens(query)), set(_norm_tokens(candidate))
    if not q or not c:
        return 0.0
    common = q & c
    score = 0.6 * len(common) / len(c) + 0.4 * len(common) / len(q)
    if (c & COLOR_WORDS) and not (q & COLOR_WORDS):
        score -= 0.5  # a coloured edition is a different set of pages
    return score


def title_variants(title: str) -> list[str]:
    """'JoJo's Bizarre Adventure Part 7 - Steel Ball Run' -> also try 'Steel Ball Run', ..."""
    t = re.sub(r"\((?:official )?colou?red\)", "", title or "", flags=re.I).strip()
    out = [t]
    parts = [p.strip() for p in re.split(r"\s+[-–—|:]\s+|:\s*", t) if p.strip()]
    for p in sorted(parts, key=len, reverse=True):
        out.append(p)
        out.append(re.sub(r"\bpart\s*\d+\b", "", p, flags=re.I).strip())
    seen, res = set(), []
    for v in out:
        v = re.sub(r"\s+", " ", v).strip(" -:")
        if len(v) >= 3 and v.lower() not in seen:
            seen.add(v.lower())
            res.append(v)
    return res[:4]


def chapter_key(text) -> float | None:
    try:
        return float(str(text).strip())
    except (TypeError, ValueError):
        return None


class Source:
    name = "?"
    referer = ""

    def __init__(self, client: httpx.AsyncClient):
        self.client = client

    async def get(self, url: str, **kw) -> httpx.Response:
        headers = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", **kw.pop("headers", {})}
        r = await self.client.get(url, headers=headers, timeout=30, follow_redirects=True, **kw)
        if r.status_code == 403 and "Just a moment" in r.text:
            raise SourceError(f"{self.name} is blocking automated access right now")
        r.raise_for_status()
        return r

    async def search(self, title: str) -> list[Series]:
        raise NotImplementedError

    async def chapters(self, series: Series) -> dict[float, str]:
        raise NotImplementedError

    async def pages(self, chapter_ref: str) -> list[str]:
        raise NotImplementedError

    def chapter_page_url(self, chapter_ref: str, index: int) -> str:
        return chapter_ref

    async def find_series(self, title: str) -> Series | None:
        best, best_score = None, 0.0
        for variant in title_variants(title):
            try:
                found = await self.search(variant)
            except SourceError:
                raise
            except Exception:  # noqa: BLE001 - one bad query should not stop the others
                continue
            for s in found[:12]:
                sc = title_score(title, s.title)
                if sc > best_score:
                    best, best_score = s, sc
            if best_score >= 0.75:
                break
        return best if best_score >= 0.45 else None


class WeebCentral(Source):
    """weebcentral.com (formerly MangaSee): often the official digital release, as lossless PNG."""
    name = "WeebCentral"
    base = "https://weebcentral.com"
    referer = "https://weebcentral.com/"

    async def search(self, title):
        r = await self.get(f"{self.base}/search/data", headers={"HX-Request": "true"}, params={
            "author": "", "text": title, "sort": "Best Match", "order": "Descending",
            "official": "Any", "anime": "Any", "adult": "Any", "display_mode": "Full Display"})
        out = []
        for sid, slug in dict.fromkeys(re.findall(r'href="https://weebcentral\.com/series/([0-9A-Z]+)/([^"]+)"', r.text)):
            out.append(Series(title=slug.replace("-", " "), ref=sid, url=f"{self.base}/series/{sid}/{slug}"))
        return out

    async def chapters(self, series):
        r = await self.get(f"{self.base}/series/{series.ref}/full-chapter-list", headers={"HX-Request": "true"})
        out = {}
        for m in re.finditer(r'<a href="/chapters/([0-9A-Z]+)"[^>]*>(.*?)</a>', r.text, re.S):
            text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2)))
            n = re.search(r"(?:#|Chapter|Episode|Ch\.?)\s*(\d+(?:\.\d+)?)", text) or re.search(r"(\d+(?:\.\d+)?)", text)
            if n:
                out.setdefault(float(n.group(1)), m.group(1))
        return out

    async def pages(self, chapter_ref):
        r = await self.get(f"{self.base}/chapters/{chapter_ref}/images", headers={
            "HX-Request": "true", "Referer": f"{self.base}/chapters/{chapter_ref}"},
            params={"is_prev": "False", "current_page": "1", "reading_style": "long_strip"})
        return list(dict.fromkeys(u for u in re.findall(r'<img[^>]+src="([^"]+)"', r.text)
                                  if u.startswith("http") and "/static/" not in u))

    def chapter_page_url(self, chapter_ref, index):
        return f"{self.base}/chapters/{chapter_ref}"


class Mangapill(Source):
    """mangapill.com"""
    name = "Mangapill"
    base = "https://mangapill.com"
    referer = "https://mangapill.com/"

    async def search(self, title):
        r = await self.get(f"{self.base}/search", params={"q": title})
        out = []
        for path, name in re.findall(r'href="(/manga/\d+/[^"]+)"[^>]*>\s*<div[^>]*>([^<]+)<', r.text):
            out.append(Series(title=html.unescape(name.strip()), ref=path, url=self.base + path))
        if not out:
            for path in dict.fromkeys(re.findall(r'href="(/manga/\d+/[^"]+)"', r.text)):
                out.append(Series(title=path.rsplit("/", 1)[-1].replace("-", " "), ref=path, url=self.base + path))
        return out

    async def chapters(self, series):
        r = await self.get(self.base + series.ref)
        out = {}
        for path, text in re.findall(r'href="(/chapters/[^"]+)"[^>]*>\s*([^<]+)<', r.text):
            n = re.search(r"(\d+(?:\.\d+)?)\s*$", text.strip())
            if n:
                out.setdefault(float(n.group(1)), path)
        return out

    async def pages(self, chapter_ref):
        r = await self.get(self.base + chapter_ref)
        return list(dict.fromkeys(re.findall(r'<img[^>]+data-src="(https?://[^"]+)"', r.text)))

    def chapter_page_url(self, chapter_ref, index):
        return self.base + chapter_ref


SOURCES = {"weebcentral": WeebCentral, "mangapill": Mangapill}
