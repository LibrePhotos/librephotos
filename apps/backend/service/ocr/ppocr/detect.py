"""DBNet text detection: preprocess -> ONNX inference -> DBPostProcess.

All geometry helpers here are pure numpy/cv2 and are unit-tested without any
model (see api/tests/test_ocr_geometry.py).  Constants come from OCRConfig,
never hardcoded.
"""

import cv2
import numpy as np
import pyclipper

# minAreaRect boxes with a shorter side below this many pixels are discarded.
MIN_BOX_SIDE = 3
# Hard cap on input pixels before detection.  DBNet allocates a probability map
# the size of the (resized) input; a 100MP flatbed scan or panorama would blow
# up memory, so downscale anything past this first.
MAX_INPUT_PIXELS = 40_000_000


class OCRDecodeError(ValueError):
    """Raised when image bytes cannot be decoded into a usable array."""


# --------------------------------------------------------------------------- #
# Pure geometry helpers (unit-tested without models)
# --------------------------------------------------------------------------- #
def polygon_area(points):
    """Absolute polygon area via the shoelace formula. points: (N, 2)."""
    pts = np.asarray(points, dtype=np.float64)
    x = pts[:, 0]
    y = pts[:, 1]
    return 0.5 * np.abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def polygon_perimeter(points):
    """Closed-polygon perimeter (sum of edge lengths). points: (N, 2)."""
    pts = np.asarray(points, dtype=np.float64)
    diffs = pts - np.roll(pts, -1, axis=0)
    return float(np.sqrt((diffs**2).sum(axis=1)).sum())


def unclip_distance(points, unclip_ratio):
    """DB unclip offset distance: area * ratio / perimeter."""
    perimeter = polygon_perimeter(points)
    if perimeter <= 0:
        return 0.0
    return polygon_area(points) * float(unclip_ratio) / perimeter


def unclip(box, unclip_ratio):
    """Expand a quad outward by the DB unclip distance.

    Returns the offset polygon as an (M, 2) float array, or None if the offset
    collapses (pyclipper can return an empty result on degenerate input).
    """
    distance = unclip_distance(box, unclip_ratio)
    offset = pyclipper.PyclipperOffset()
    offset.AddPath(
        [(float(p[0]), float(p[1])) for p in box],
        pyclipper.JT_ROUND,
        pyclipper.ET_CLOSEDPOLYGON,
    )
    expanded = offset.Execute(distance)
    if not expanded:
        return None
    return np.array(expanded[0], dtype=np.float64)


def order_points_clockwise(pts):
    """Order points clockwise starting at the top-left corner.

    Sorts by angle around the centroid, which in image coordinates (y pointing
    down) yields a clockwise cycle, then rotates the cycle so it starts at the
    top-left-most corner (smallest x + y).  This is robust to rotation and
    reflection - including a perfect 45-degree diamond, where a sum/diff scheme
    would collapse two tied corners.  Returns a (N, 2) float32.
    """
    pts = np.asarray(pts, dtype=np.float32)
    center = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    ordered = pts[np.argsort(angles)]
    start = int(np.argmin(ordered.sum(axis=1)))
    return np.roll(ordered, -start, axis=0).astype(np.float32)


def get_mini_boxes(contour):
    """minAreaRect of a contour, returned as clockwise TL,TR,BR,BL + short side.

    Mirrors PaddleOCR's DBPostProcess.get_mini_boxes so downstream ordering is
    identical to the reference implementation.
    """
    bounding_box = cv2.minAreaRect(contour)
    points = sorted(list(cv2.boxPoints(bounding_box)), key=lambda p: p[0])

    if points[1][1] > points[0][1]:
        index_1, index_4 = 0, 1
    else:
        index_1, index_4 = 1, 0
    if points[3][1] > points[2][1]:
        index_2, index_3 = 2, 3
    else:
        index_2, index_3 = 3, 2

    box = np.array(
        [points[index_1], points[index_2], points[index_3], points[index_4]],
        dtype=np.float32,
    )
    return box, min(bounding_box[1])


def box_score_fast(prob_map, box):
    """Mean probability inside a quad (fillPoly mask over its bounding rect)."""
    h, w = prob_map.shape[:2]
    box = np.asarray(box, dtype=np.float32).copy()
    xmin = int(np.clip(np.floor(box[:, 0].min()), 0, w - 1))
    xmax = int(np.clip(np.ceil(box[:, 0].max()), 0, w - 1))
    ymin = int(np.clip(np.floor(box[:, 1].min()), 0, h - 1))
    ymax = int(np.clip(np.ceil(box[:, 1].max()), 0, h - 1))

    mask = np.zeros((ymax - ymin + 1, xmax - xmin + 1), dtype=np.uint8)
    box[:, 0] -= xmin
    box[:, 1] -= ymin
    cv2.fillPoly(mask, [box.astype(np.int32)], 1)
    region = prob_map[ymin : ymax + 1, xmin : xmax + 1]
    return float(cv2.mean(region.astype(np.float32), mask)[0])


def round_up_to_multiple(value, multiple):
    """Smallest multiple of ``multiple`` that is >= value, and >= ``multiple``."""
    value = max(int(value), 1)
    n = -(-value // multiple)  # ceil division
    return max(multiple, n * multiple)


def compute_resize(h, w, max_side, multiple):
    """Target (height, width) for detection input.

    Downscale so the longest side is <= ``max_side`` (never upscale), then round
    both dimensions up to the nearest ``multiple`` (minimum one ``multiple``).
    """
    ratio = 1.0
    longest = max(h, w)
    if longest > max_side:
        ratio = max_side / float(longest)
    rh = int(round(h * ratio))
    rw = int(round(w * ratio))
    return round_up_to_multiple(rh, multiple), round_up_to_multiple(rw, multiple)


# --------------------------------------------------------------------------- #
# Image loading
# --------------------------------------------------------------------------- #
def to_uint8(img):
    """Coerce a decoded array to 8-bit samples (uint8 input passes through)."""
    if img.dtype == np.uint16:
        return (img.astype(np.float32) / 257.0).astype(np.uint8)
    if img.dtype != np.uint8:
        return np.clip(img, 0, 255).astype(np.uint8)
    return img


# Channel counts that cv2 can convert to BGR directly.
_BGR_CONVERSIONS = {1: cv2.COLOR_GRAY2BGR, 4: cv2.COLOR_BGRA2BGR}


def to_bgr_3channel(img):
    """Coerce any decoded array to 8-bit 3-channel BGR."""
    img = to_uint8(img)

    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.ndim != 3:
        raise OCRDecodeError(f"unsupported image shape {img.shape}")

    channels = img.shape[2]
    if channels == 3:
        return img
    conversion = _BGR_CONVERSIONS.get(channels)
    if conversion is not None:
        return cv2.cvtColor(img, conversion)
    return np.ascontiguousarray(img[:, :, :3])


def read_image(image_path, max_pixels=MAX_INPUT_PIXELS):
    """Read an image file into an 8-bit BGR array, capping total pixels.

    A missing or unreadable path is surfaced as OCRDecodeError so the endpoint
    maps it to a 4xx (bad input), not a generic 500.
    """
    try:
        with open(image_path, "rb") as f:
            buf = f.read()
    except OSError as exc:
        raise OCRDecodeError(f"could not read image at {image_path}: {exc}") from exc
    arr = np.frombuffer(buf, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        # Retry forcing colour; some palette PNGs decode poorly UNCHANGED.
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise OCRDecodeError(f"could not decode image at {image_path}")

    img = to_bgr_3channel(img)

    h, w = img.shape[:2]
    if h * w > max_pixels:
        scale = (max_pixels / float(h * w)) ** 0.5
        img = cv2.resize(
            img,
            (max(1, int(w * scale)), max(1, int(h * scale))),
            interpolation=cv2.INTER_AREA,
        )
    return img


# --------------------------------------------------------------------------- #
# Preprocess / postprocess
# --------------------------------------------------------------------------- #
def normalize_image(img_bgr, config):
    """Scale + mean/std normalize, HWC->CHW, add batch dim, float32.

    The image is BGR (cv2 decode).  The mean/std in config are RGB-ordered in
    the upstream inference.yml, but PaddleOCR's pipeline runs DecodeImage with
    img_mode='BGR' followed by NormalizeImage, which subtracts the listed
    values from the channels *in the image's own order without reordering them*.
    We replicate that reference behaviour: apply mean/std to the channels as-is.

    The channel order the model expects comes from config.det_img_mode: the
    bundled model uses "BGR", so the cv2-decoded BGR array is fed straight
    through (the no-op default).  A bundle declaring "RGB" gets its channels
    swapped here before normalization so mean/std still land on the right
    channels.
    """
    img = img_bgr
    if str(config.det_img_mode).upper() == "RGB":
        img = img[:, :, ::-1]  # BGR -> RGB to match the model's declared order
    x = img.astype(np.float32) * config.det_scale
    x = (x - config.det_mean) / config.det_std
    x = x.transpose(2, 0, 1)[np.newaxis, ...]
    return np.ascontiguousarray(x, dtype=np.float32)


def quad_from_contour(contour, prob_map, config):
    """Unclipped quad for one contour, or None if it fails a DB reject gate."""
    points, sside = get_mini_boxes(contour)
    if sside < MIN_BOX_SIDE:
        return None

    if box_score_fast(prob_map, points) < config.det_box_thresh:
        return None

    expanded = unclip(points, config.det_unclip_ratio)
    if expanded is None or len(expanded) < 4:
        return None

    box, sside = get_mini_boxes(expanded.reshape(-1, 1, 2).astype(np.float32))
    if sside < MIN_BOX_SIDE + 2:
        return None

    return order_points_clockwise(box)


def rescale_quad(box, size, dest_size):
    """Map a quad from (width, height) to (dest_width, dest_height), clipped."""
    width, height = size
    dest_width, dest_height = dest_size
    box[:, 0] = np.clip(np.round(box[:, 0] / width * dest_width), 0, dest_width)
    box[:, 1] = np.clip(np.round(box[:, 1] / height * dest_height), 0, dest_height)
    return box.astype(np.int32)


def boxes_from_bitmap(prob_map, config, dest_width, dest_height):
    """DBPostProcess: probability map -> list of quads in original coordinates.

    Returns a list of (4, 2) int32 boxes ordered clockwise from the top-left,
    already rescaled to the original image size and clipped to its bounds.
    """
    height, width = prob_map.shape[:2]
    bitmap = (prob_map > config.det_thresh).astype(np.uint8)

    contours, _ = cv2.findContours(bitmap * 255, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    num_contours = max(0, min(len(contours), config.det_max_candidates))

    boxes = []
    for contour in contours[:num_contours]:
        box = quad_from_contour(contour, prob_map, config)
        if box is not None:
            boxes.append(rescale_quad(box, (width, height), (dest_width, dest_height)))

    return boxes


def detect(session, input_name, img_bgr, config, max_side):
    """Run detection, returning (boxes, prob_map).

    boxes are (4, 2) int32 quads in original image coordinates.
    """
    h, w = img_bgr.shape[:2]
    nh, nw = compute_resize(h, w, max_side, config.det_size_multiple)
    resized = cv2.resize(img_bgr, (nw, nh))

    x = normalize_image(resized, config)
    output = session.run(None, {input_name: x})[0]
    prob_map = np.asarray(output[0, 0], dtype=np.float32)

    boxes = boxes_from_bitmap(prob_map, config, dest_width=w, dest_height=h)
    return boxes, prob_map
