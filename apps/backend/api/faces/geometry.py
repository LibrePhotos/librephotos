"""Face box geometry: how much two face boxes overlap.

A box is ``(top, right, bottom, left)`` in pixels, the order ``Face`` stores
its ``location_*`` fields in and the face service returns.
"""

# (top, right, bottom, left), with top < bottom and left < right.
Box = tuple[float, float, float, float]

# Minimum IoU to consider two face bounding boxes as the same face.
FACE_OVERLAP_IOU_THRESHOLD = 0.3


def calculate_iou(box1: Box, box2: Box) -> float:
    """Calculate Intersection over Union (IoU) of two bounding boxes.

    Returns a float in [0, 1]. A value of 0 means no overlap.
    """
    box1_top, box1_right, box1_bottom, box1_left = box1
    box2_top, box2_right, box2_bottom, box2_left = box2

    inter_top = max(box1_top, box2_top)
    inter_left = max(box1_left, box2_left)
    inter_bottom = min(box1_bottom, box2_bottom)
    inter_right = min(box1_right, box2_right)

    inter_width = max(0, inter_right - inter_left)
    inter_height = max(0, inter_bottom - inter_top)
    intersection = inter_width * inter_height

    area1 = (box1_bottom - box1_top) * (box1_right - box1_left)
    area2 = (box2_bottom - box2_top) * (box2_right - box2_left)
    union = area1 + area2 - intersection

    if union <= 0:
        return 0.0

    return intersection / union


def min_face_height(image_shape: tuple[int, ...], min_face_size: float) -> float:
    """The lowest face, in pixels, a user's ``min_face_size`` keeps (#2749).

    ``min_face_size`` is a share of the picture's shorter side, so it means
    the same for portrait and landscape pictures; ``image_shape`` is the
    picture's (height, width, ...) as numpy gives it. 0 keeps every face.
    """
    if min_face_size <= 0:
        return 0.0
    height, width = image_shape[:2]
    return min_face_size * min(height, width)
