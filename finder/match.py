"""Locate the query image inside a candidate image.

SIFT keypoints + RANSAC give a similarity transform (scale, rotation, shift, optional mirror)
from query pixels to candidate pixels. A photometric check then confirms the candidate really
shows the same artwork (and not just a matching watermark or a similar-looking panel).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

QUERY_SIDE = 1400   # resolution used to detect query keypoints
CAND_SIDE = 2000    # resolution used to detect candidate keypoints


@dataclass
class Features:
    pts: np.ndarray            # Nx2 keypoint positions in original-image pixels
    desc: np.ndarray | None
    shape: tuple[int, int]     # (h, w) of the original image
    work_scale: float


@dataclass
class Match:
    M: np.ndarray              # 2x3 affine: query px -> candidate px (may contain a mirror)
    scale: float               # candidate px per query px
    angle: float               # degrees
    inliers: int
    good: int
    mirrored: bool
    ncc: float = 0.0           # overall similarity of the overlapping art
    agree: float = 0.0         # share of detailed blocks that match
    differ: float = 0.0        # share of detailed blocks that clearly differ (text, edits)


def extract(gray: np.ndarray, max_side: int, nfeatures: int = 5000) -> Features:
    h, w = gray.shape
    f = min(1.0, max_side / max(h, w))
    img = gray if f >= 1 else cv2.resize(gray, (max(1, round(w * f)), max(1, round(h * f))),
                                         interpolation=cv2.INTER_AREA)
    sift = cv2.SIFT_create(nfeatures=nfeatures)
    kps, desc = sift.detectAndCompute(img, None)
    if desc is None or not kps:
        return Features(np.zeros((0, 2), np.float32), None, (h, w), f)
    pts = np.array([k.pt for k in kps], np.float32) / f
    return Features(pts, desc, (h, w), f)


def mirror_features(gray: np.ndarray, max_side: int, nfeatures: int = 5000) -> Features:
    """Features of the horizontally mirrored image (coordinates stay in the mirrored frame)."""
    return extract(cv2.flip(gray, 1), max_side, nfeatures)


# ---------------------------------------------------------------- affine helpers

def to3(M: np.ndarray) -> np.ndarray:
    return np.vstack([M.astype(np.float64), [0.0, 0.0, 1.0]])


def compose(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """A after B (apply B first)."""
    return (to3(A) @ to3(B))[:2]


def invert(M: np.ndarray) -> np.ndarray:
    return np.linalg.inv(to3(M))[:2]


def apply(M: np.ndarray, pts) -> np.ndarray:
    p = np.asarray(pts, np.float64).reshape(-1, 2)
    return p @ M[:, :2].T + M[:, 2]


def scale_of(M: np.ndarray) -> float:
    return float(math.sqrt(abs(np.linalg.det(M[:, :2]))))


def rect_poly(x0, y0, x1, y1) -> np.ndarray:
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float64)


# ---------------------------------------------------------------- matching

def _estimate(qf: Features, cf: Features, ratio: float = 0.78):
    if qf.desc is None or cf.desc is None or len(qf.pts) < 8 or len(cf.pts) < 8:
        return None
    matcher = cv2.FlannBasedMatcher(dict(algorithm=1, trees=5), dict(checks=64))
    knn = matcher.knnMatch(qf.desc, cf.desc, k=2)
    good = [p[0] for p in knn if len(p) == 2 and p[0].distance < ratio * p[1].distance]
    if len(good) < 10:
        return None
    src = qf.pts[[m.queryIdx for m in good]]
    dst = cf.pts[[m.trainIdx for m in good]]
    thr = 4.0 / max(cf.work_scale, 1e-3)
    M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=thr,
                                         maxIters=6000, confidence=0.997, refineIters=10)
    if M is None or inl is None:
        return None
    n_in = int(inl.sum())
    if n_in < max(10, int(0.08 * len(good))):
        return None
    s = scale_of(M)
    angle = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    if not (0.04 <= s <= 25) or abs(angle) > 12:
        return None
    # inliers must not all sit in one tiny spot (a shared logo or watermark)
    ip = src[inl.ravel().astype(bool)]
    span = (np.ptp(ip[:, 0]) * np.ptp(ip[:, 1])) / max(1.0, qf.shape[0] * qf.shape[1])
    if span < 0.004:
        return None
    return M, s, angle, n_in, len(good)


def find(query_gray: np.ndarray, qf: Features, qf_mirror: Features | None,
         cand_gray: np.ndarray, cf: Features) -> Match | None:
    best = None
    r = _estimate(qf, cf)
    if r is not None:
        M, s, angle, n_in, n_good = r
        best = Match(M, s, angle, n_in, n_good, False)
    elif qf_mirror is not None:
        r = _estimate(qf_mirror, cf)
        if r is not None:
            Mf, s, angle, n_in, n_good = r
            w = query_gray.shape[1]
            flip = np.array([[-1.0, 0.0, w - 1.0], [0.0, 1.0, 0.0]])
            best = Match(compose(Mf, flip), s, angle, n_in, n_good, True)
    if best is None:
        return None
    ok = verify(query_gray, cand_gray, best)
    return best if ok else None


# ---------------------------------------------------------------- rendering + verification

def render_in_query_frame(cand: np.ndarray, M: np.ndarray, q_shape, out_scale: float,
                          fill: int = 255, interp: int = cv2.INTER_LINEAR):
    """Resample the candidate into the query's frame (query size * out_scale).

    Returns (image, valid_mask). Works for gray (HxW) and colour (HxWx3) candidates.
    """
    qh, qw = q_shape
    oh, ow = max(1, round(qh * out_scale)), max(1, round(qw * out_scale))
    s = scale_of(M)
    src, Mq2s = cand, M
    pre = out_scale / s
    if pre < 0.8:  # shrink first with area averaging, so fine screentones do not alias
        nw, nh = max(1, round(cand.shape[1] * pre)), max(1, round(cand.shape[0] * pre))
        src = cv2.resize(cand, (nw, nh), interpolation=cv2.INTER_AREA)
        sx, sy = nw / cand.shape[1], nh / cand.shape[0]
        Mq2s = np.diag([sx, sy]) @ M
    out2q = np.array([[1.0 / out_scale, 0, 0], [0, 1.0 / out_scale, 0]])
    out2src = compose(Mq2s, out2q)
    border = (fill, fill, fill) if src.ndim == 3 else fill
    warped = cv2.warpAffine(src, out2src, (ow, oh), flags=interp | cv2.WARP_INVERSE_MAP,
                            borderMode=cv2.BORDER_CONSTANT, borderValue=border)
    ones = np.full(src.shape[:2], 255, np.uint8)
    mask = cv2.warpAffine(ones, out2src, (ow, oh), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return warped, mask > 0


def overlap_box(M: np.ndarray, q_shape, c_shape):
    """Bounding box (query px) of the part of the query that the candidate also shows."""
    qh, qw = q_shape
    ch, cw = c_shape
    poly = apply(invert(M), rect_poly(0, 0, cw, ch))
    x0, y0 = max(0.0, poly[:, 0].min()), max(0.0, poly[:, 1].min())
    x1, y1 = min(float(qw), poly[:, 0].max()), min(float(qh), poly[:, 1].max())
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    return x0, y0, x1, y1


def compare_maps(q_gray: np.ndarray, cand: np.ndarray, M: np.ndarray, work_side: int = 640,
                 blur: float = 1.2, with_offset: bool = False):
    """Render query and candidate overlap at a common small size, blurred to kill tone moire."""
    box = overlap_box(M, q_gray.shape, cand.shape)
    if box is None:
        return None
    x0, y0, x1, y1 = box
    f = min(1.0, work_side / max(x1 - x0, y1 - y0))
    qh, qw = q_gray.shape
    q_small = q_gray if f >= 1 else cv2.resize(q_gray, (max(1, round(qw * f)), max(1, round(qh * f))),
                                               interpolation=cv2.INTER_AREA)
    c_small, mask = render_in_query_frame(cand, M, (qh, qw), f)
    h = min(q_small.shape[0], c_small.shape[0])
    w = min(q_small.shape[1], c_small.shape[1])
    sl = (slice(int(y0 * f), min(h, int(math.ceil(y1 * f)))), slice(int(x0 * f), min(w, int(math.ceil(x1 * f)))))
    a = q_small[sl].astype(np.float32)
    b = c_small[sl].astype(np.float32)
    m = mask[sl]
    if a.size < 400:
        return None
    m = cv2.erode(m.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    a = cv2.GaussianBlur(a, (0, 0), blur)
    b = cv2.GaussianBlur(b, (0, 0), blur)
    if with_offset:
        return a, b, m, (int(x0 * f), int(y0 * f), f)
    return a, b, m


def differences(q_gray: np.ndarray, cand_gray: np.ndarray, M: np.ndarray, work_side: int = 1100):
    """Find places where the candidate's art/text differs from the query (other language, edits).

    Returns (share_of_overlap_that_differs, [boxes in query px]).
    """
    maps = compare_maps(q_gray, cand_gray, M, work_side=work_side, blur=2.0, with_offset=True)
    if maps is None:
        return 0.0, []
    a, b, m, (ox, oy, f) = maps
    if m.sum() < 500:
        return 0.0, []
    # match the candidate's tones to the query (levels, gamma-ish) with a linear fit
    bv, av = b[m], a[m]
    A = np.vstack([bv, np.ones_like(bv)]).T
    gain, offs = np.linalg.lstsq(A, av, rcond=None)[0]
    d = np.abs(a - (b * gain + offs))
    d[~m] = 0
    bad = (d > 55).astype(np.uint8)
    bad = cv2.morphologyEx(bad, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))  # drop thin misalignment lines
    blobs = cv2.dilate(bad, np.ones((7, 7), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(blobs)
    area = float(m.sum())
    boxes = []
    keep = 0
    for i in range(1, n):
        x, y, w, h, ar = stats[i]
        if ar < max(60, area * 0.0004):
            continue
        keep += ar
        boxes.append([(ox + x) / f, (oy + y) / f, (ox + x + w) / f, (oy + y + h) / f, int(ar)])
    boxes.sort(key=lambda r: -r[4])
    return float(keep / area), [r[:4] for r in boxes[:12]]


def verify(q_gray: np.ndarray, cand_gray: np.ndarray, match: Match) -> bool:
    maps = compare_maps(q_gray, cand_gray, match.M)
    if maps is None:
        return False
    a, b, m = maps
    if m.sum() < 300:
        return False
    av, bv = a[m], b[m]
    sa, sb = av.std(), bv.std()
    if sa < 3 or sb < 3:
        return False
    ncc = float(((av - av.mean()) * (bv - bv.mean())).mean() / (sa * sb))
    # block-wise agreement: tells "same art, different text" apart from "different picture"
    h, w = a.shape
    bs = max(12, int(max(h, w) / 14))
    agree = differ = informative = 0
    for y in range(0, h - bs + 1, bs):
        for x in range(0, w - bs + 1, bs):
            mm = m[y:y + bs, x:x + bs]
            if mm.mean() < 0.9:
                continue
            pa, pb = a[y:y + bs, x:x + bs], b[y:y + bs, x:x + bs]
            if pa.std() < 6 and pb.std() < 6:
                continue  # flat area (paper / solid black) tells us nothing
            informative += 1
            c = float(((pa - pa.mean()) * (pb - pb.mean())).mean() / (pa.std() * pb.std() + 1e-6))
            if c > 0.5:
                agree += 1
            elif c < 0.2:
                differ += 1
    if informative == 0:
        return False
    match.ncc = ncc
    match.agree = agree / informative
    match.differ = differ / informative
    return (ncc >= 0.30 and match.agree >= 0.40) or (ncc >= 0.55 and match.agree >= 0.30)


# ---------------------------------------------------------------- geometry metrics

def geometry(M: np.ndarray, q_shape, c_shape, roi=None) -> dict:
    """How much of the region of interest the candidate shows, and what it adds around it."""
    qh, qw = q_shape
    ch, cw = c_shape
    rx0, ry0, rx1, ry1 = roi if roi else (0.0, 0.0, float(qw), float(qh))
    rw, rh = rx1 - rx0, ry1 - ry0
    roi_poly = rect_poly(rx0, ry0, rx1, ry1).astype(np.float32)
    cand_q = apply(invert(M), rect_poly(0, 0, cw, ch)).astype(np.float32)
    inter, _ = cv2.intersectConvexConvex(cv2.convexHull(roi_poly), cv2.convexHull(cand_q))
    coverage = float(max(0.0, inter) / max(1.0, rw * rh))
    extra = {
        "left": max(0.0, rx0 - float(cand_q[:, 0].min())) / rw,
        "right": max(0.0, float(cand_q[:, 0].max()) - rx1) / rw,
        "top": max(0.0, ry0 - float(cand_q[:, 1].min())) / rh,
        "bottom": max(0.0, float(cand_q[:, 1].max()) - ry1) / rh,
    }
    roi_c = apply(M, rect_poly(rx0, ry0, rx1, ry1))
    bx0 = float(np.clip(roi_c[:, 0].min(), 0, cw))
    by0 = float(np.clip(roi_c[:, 1].min(), 0, ch))
    bx1 = float(np.clip(roi_c[:, 0].max(), 0, cw))
    by1 = float(np.clip(roi_c[:, 1].max(), 0, ch))
    return {"coverage": min(1.0, coverage), "extra": extra, "roi_in_cand": [bx0, by0, bx1, by1],
            "cand_in_query": cand_q.tolist()}
