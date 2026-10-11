"""Downloading candidate images politely and safely."""
from __future__ import annotations

import asyncio
import ipaddress
from urllib.parse import urlparse

import httpx

from .engines import APP_UA, UA, Candidate

MAX_BYTES = 45 * 1024 * 1024
_OK_TYPES = ("image/", "application/octet-stream", "binary/octet-stream", "application/binary")


class FetchError(Exception):
    pass


_host_locks: dict[str, asyncio.Semaphore] = {}


def _host_sem(host: str) -> asyncio.Semaphore:
    if host not in _host_locks:
        _host_locks[host] = asyncio.Semaphore(4)  # never hammer one site
    return _host_locks[host]


def _is_local(hostname: str) -> bool:
    if hostname in ("localhost", "") or hostname.endswith((".local", ".localhost")):
        return True
    try:
        ip = ipaddress.ip_address(hostname.strip("[]"))
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved


def _origin(u: str) -> str:
    p = urlparse(u)
    return f"{p.scheme}://{p.netloc}/" if p.scheme and p.netloc else ""


async def _get(client: httpx.AsyncClient, url: str, headers: dict, timeout: float) -> bytes:
    async with client.stream("GET", url, headers=headers, timeout=timeout, follow_redirects=True) as r:
        if r.status_code != 200:
            raise FetchError(f"HTTP {r.status_code}")
        ct = r.headers.get("content-type", "").lower()
        if ct and not ct.startswith(_OK_TYPES):
            raise FetchError(f"not an image ({ct.split(';')[0]})")
        n = int(r.headers.get("content-length") or 0)
        if n > MAX_BYTES:
            raise FetchError("file is too big")
        buf = bytearray()
        async for chunk in r.aiter_bytes():
            buf.extend(chunk)
            if len(buf) > MAX_BYTES:
                raise FetchError("file is too big")
        if len(buf) < 200:
            raise FetchError("empty file")
        return bytes(buf)


async def fetch_image(client: httpx.AsyncClient, cand: Candidate, timeout: float = 25) -> bytes:
    url = cand.url
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise FetchError("not a web address")
    host = p.netloc.lower()
    if _is_local(p.hostname or ""):
        raise FetchError("refusing to fetch a local address")
    ua = APP_UA if "mangadex" in host else UA
    base = {"User-Agent": ua, "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"}
    referers = []
    if cand.referer:
        referers.append(cand.referer)
    if cand.page_url:
        referers.append(_origin(cand.page_url))
    referers.append("")
    async with _host_sem(host):
        last: Exception | None = None
        for ref in dict.fromkeys(referers):  # unique, in order
            headers = dict(base)
            if ref:
                headers["Referer"] = ref
            try:
                return await _get(client, url, headers, timeout)
            except FetchError as e:
                last = e
                if "HTTP 403" not in str(e) and "HTTP 401" not in str(e):
                    raise
            except httpx.HTTPError as e:
                raise FetchError(type(e).__name__) from e
        raise last or FetchError("failed")
