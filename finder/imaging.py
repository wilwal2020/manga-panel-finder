"""Decoding images and measuring how much real detail they contain."""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 150_000_000  # big enough for huge scans, small enough to stop decompression bombs
MAX_PIXELS = 80_000_000

# IJG standard luminance quantisation table (quality 50), used to estimate JPEG quality.
_STD_LUMA_SUM = sum([
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
])


class NotAnImage(Exception):
    pass


@dataclass
class Picture:
    data: bytes                 # original file bytes, never re-encoded
    gray: np.ndarray            # uint8 HxW
    rgb: np.ndarray | None      # uint8 HxWx3, only kept for colour images
    format: str                 # 'JPEG', 'PNG', 'WEBP', ...
    jpeg_quality: int | None
    colored: bool
    sha1: str
    ext: str = field(default=".jpg")

    @property
    def width(self) -> int:
        return int(self.gray.shape[1])

    @property
    def height(self) -> int:
        return int(self.gray.shape[0])


def estimate_jpeg_quality(im: Image.Image) -> int | None:
    tables = getattr(im, "quantization", None)
    if not tables:
        return None
    luma = tables.get(0)
    if not luma or len(luma) != 64:
        return None
    s = 100.0 * sum(luma) / _STD_LUMA_SUM
    q = (200.0 - s) / 2.0 if s <= 100 else 5000.0 / s
    return int(max(1, min(100, round(q))))


def _is_colored(rgb: np.ndarray) -> bool:
    """True when a meaningful part of the image is clearly coloured (not just yellowed paper)."""
    small = rgb
    if rgb.shape[0] * rgb.shape[1] > 1_000_000:
        f = (1_000_000 / (rgb.shape[0] * rgb.shape[1])) ** 0.5
        small = cv2.resize(rgb, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_RGB2HSV)
    sat = hsv[..., 1].astype(np.float32) / 255.0
    val = hsv[..., 2].astype(np.float32) / 255.0
    strong = (sat > 0.30) & (val > 0.20)
    return float(strong.mean()) > 0.04


EXT_FOR_FORMAT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif", "BMP": ".bmp",
                  "TIFF": ".tif", "AVIF": ".avif", "MPO": ".jpg"}


def decode(data: bytes) -> Picture:
    try:
        im = Image.open(io.BytesIO(data))
        fmt = (im.format or "").upper()
        if im.width * im.height > MAX_PIXELS:
            raise NotAnImage(f"image too large ({im.width}x{im.height})")
        jq = estimate_jpeg_quality(im) if fmt in ("JPEG", "MPO") else None
        if getattr(im, "is_animated", False):
            im.seek(0)
        try:
            im = ImageOps.exif_transpose(im)
        except Exception:  # noqa: BLE001 - broken EXIF should not stop us
            pass
        if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
            im = im.convert("RGBA")
            bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
            bg.alpha_composite(im)
            im = bg.convert("RGB")
        if im.mode in ("L", "1", "I;16", "I", "F"):
            gray = np.asarray(im.convert("L"))
            rgb = None
            colored = False
        else:
            rgb = np.asarray(im.convert("RGB"))
            colored = _is_colored(rgb)
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
            if not colored:
                rgb = None
    except NotAnImage:
        raise
    except Exception as e:  # noqa: BLE001
        raise NotAnImage(str(e)) from e
    if gray.shape[0] < 16 or gray.shape[1] < 16:
        raise NotAnImage("image too small")
    return Picture(data=data, gray=np.ascontiguousarray(gray), rgb=rgb, format=fmt or "?",
                   jpeg_quality=jq, colored=colored, sha1=hashlib.sha1(data).hexdigest(),
                   ext=EXT_FOR_FORMAT.get(fmt, ".img"))


def edge_width(gray: np.ndarray, max_pixels: int = 5_000_000) -> float | None:
    """Median width (in pixels) of strong ink edges.

    A crisp image has edges that jump from paper to ink in about 1 pixel. An image that was
    blown up from a smaller one (or is blurry) has edges spread over several pixels, so
    pixel-count / edge-width is a good estimate of how much *real* detail an image holds.
    """
    g = gray
    if g.size > max_pixels:  # analyse a centred window; sharpness is uniform across a page
        side = int(max_pixels ** 0.5)
        h, w = g.shape
        y0 = max(0, (h - side) // 2)
        x0 = max(0, (w - side) // 2)
        g = g[y0:y0 + side, x0:x0 + side]
    if min(g.shape) < 24:
        return None
    g = g.astype(np.float32) / 255.0
    grad = np.zeros_like(g)
    grad[:, :-1] = np.abs(g[:, 1:] - g[:, :-1])
    grad[:-1, :] = np.maximum(grad[:-1, :], np.abs(g[1:, :] - g[:-1, :]))
    k = np.ones((9, 9), np.uint8)
    contrast = cv2.dilate(g, k) - cv2.erode(g, k)
    peak = cv2.dilate(grad, np.ones((5, 5), np.uint8))
    sel = (contrast > 0.5) & (grad >= peak - 1e-6) & (grad > 0.06)
    n = int(sel.sum())
    if n < 150:
        return None
    w = contrast[sel] / grad[sel]
    return float(np.clip(np.median(w), 0.8, 12.0))


def thumbnail_jpeg(gray_or_rgb: np.ndarray, max_side: int = 360, quality: int = 85) -> bytes:
    h, w = gray_or_rgb.shape[:2]
    f = min(1.0, max_side / max(h, w))
    img = gray_or_rgb
    if f < 1:
        img = cv2.resize(img, (max(1, round(w * f)), max(1, round(h * f))), interpolation=cv2.INTER_AREA)
    pil = Image.fromarray(img)
    buf = io.BytesIO()
    pil.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def encode_png(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG", optimize=False, compress_level=6)
    return buf.getvalue()


def upload_version(pic: Picture, max_side: int = 1600) -> bytes:
    """A JPEG copy of the query that search engines accept (size-limited, no metadata)."""
    src = pic.rgb if pic.rgb is not None else pic.gray
    h, w = src.shape[:2]
    f = min(1.0, max_side / max(h, w))
    if f < 1:
        src = cv2.resize(src, (round(w * f), round(h * f)), interpolation=cv2.INTER_AREA)
    buf = io.BytesIO()
    Image.fromarray(src).save(buf, "JPEG", quality=92)
    return buf.getvalue()
