"""Grow a box outward until it hits the gutters around a manga panel."""
from __future__ import annotations

import math

import cv2
import numpy as np

LIGHT = 200   # paper-coloured gutters
DARK = 50     # black gutters (night scenes, flashbacks)
GUTTER_SHARE = 0.92


def expand_to_panel(gray: np.ndarray, box, max_grow: float = 0.55, work_side: int = 1600):
    """Return (x0, y0, x1, y1) in full-res pixels: `box` grown out to the surrounding panel borders.

    Each side walks outward until it meets a row/column that is almost entirely gutter (white
    paper or solid black). A side that finds no gutter within `max_grow` of the box size stays
    where it was, unless the walk reached the image edge (the panel bleeds off the page).
    """
    H, W = gray.shape
    f = min(1.0, work_side / max(H, W))
    g = gray if f >= 1 else cv2.resize(gray, (max(1, round(W * f)), max(1, round(H * f))),
                                       interpolation=cv2.INTER_AREA)
    h, w = g.shape
    light = g >= LIGHT
    dark = g <= DARK

    x0 = int(np.clip(math.floor(box[0] * f), 0, w - 1))
    y0 = int(np.clip(math.floor(box[1] * f), 0, h - 1))
    x1 = int(np.clip(math.ceil(box[2] * f), x0 + 1, w))
    y1 = int(np.clip(math.ceil(box[3] * f), y0 + 1, h))
    bw0, bh0 = x1 - x0, y1 - y0

    def col_gutter(x, a, b):
        return light[a:b, x].mean() >= GUTTER_SHARE or dark[a:b, x].mean() >= GUTTER_SHARE

    def row_gutter(y, a, b):
        return light[y, a:b].mean() >= GUTTER_SHARE or dark[y, a:b].mean() >= GUTTER_SHARE

    def walk(start, step, limit, edge, is_gutter):
        """Walk outward from `start`; returns new edge coordinate or None."""
        pos = start
        for _ in range(limit):
            pos += step
            if pos < 0 or pos >= edge:
                return 0 if step < 0 else edge  # ran off the page: panel bleeds to the edge
            if is_gutter(pos):
                return pos + 1 if step < 0 else pos  # stop just inside the gutter
        return None

    for _ in range(3):
        before = (x0, y0, x1, y1)
        if not col_gutter(x0, y0, y1):
            nx = walk(x0, -1, int(max_grow * bw0) + 1, w, lambda x: col_gutter(x, y0, y1))
            if nx is not None:
                x0 = nx
        if not col_gutter(x1 - 1, y0, y1):
            nx = walk(x1 - 1, 1, int(max_grow * bw0) + 1, w, lambda x: col_gutter(x, y0, y1))
            if nx is not None:
                x1 = nx
        if not row_gutter(y0, x0, x1):
            ny = walk(y0, -1, int(max_grow * bh0) + 1, h, lambda y: row_gutter(y, x0, x1))
            if ny is not None:
                y0 = ny
        if not row_gutter(y1 - 1, x0, x1):
            ny = walk(y1 - 1, 1, int(max_grow * bh0) + 1, h, lambda y: row_gutter(y, x0, x1))
            if ny is not None:
                y1 = ny
        if (x0, y0, x1, y1) == before:
            break

    pad = 2  # keep a sliver of gutter so the panel border line is never cut
    X0 = max(0, int(math.floor((x0 - pad) / f)))
    Y0 = max(0, int(math.floor((y0 - pad) / f)))
    X1 = min(W, int(math.ceil((x1 + pad) / f)))
    Y1 = min(H, int(math.ceil((y1 + pad) / f)))
    # never return something smaller than what we were given
    X0, Y0 = min(X0, int(box[0])), min(Y0, int(box[1]))
    X1, Y1 = max(X1, int(math.ceil(box[2]))), max(Y1, int(math.ceil(box[3])))
    return [max(0, X0), max(0, Y0), min(W, X1), min(H, Y1)]


def suggest_crop(gray: np.ndarray, roi_in_cand) -> tuple[list[int], str]:
    """Pick the crop to offer for saving: the whole image or the panel around the matched area."""
    H, W = gray.shape
    x0, y0, x1, y1 = roi_in_cand
    if (x1 - x0) * (y1 - y0) >= 0.82 * W * H:
        return [0, 0, W, H], "full"
    box = expand_to_panel(gray, roi_in_cand)
    if (box[2] - box[0]) * (box[3] - box[1]) >= 0.9 * W * H:
        return [0, 0, W, H], "full"
    return box, "panel"
