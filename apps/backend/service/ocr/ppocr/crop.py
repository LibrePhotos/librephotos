"""Perspective-crop a detected quad into an axis-aligned text image."""

import cv2
import numpy as np

# A crop taller than it is wide by this ratio is text written top-to-bottom in
# the crop's frame; rotate it 90 degrees so the recognizer sees a horizontal
# line (matches PaddleOCR's get_rotate_crop_image).
ROTATE_ASPECT_THRESHOLD = 1.5


def get_rotate_crop_image(img, points):
    """Warp the quad ``points`` out of ``img`` into an upright rectangle.

    ``points`` is a (4, 2) array ordered clockwise from the top-left.  The output
    width/height come from the quad's own edge lengths; if the result is much
    taller than wide it is rotated 90 degrees counter-clockwise.
    """
    points = np.asarray(points, dtype=np.float32)

    crop_width = int(
        max(
            np.linalg.norm(points[0] - points[1]),
            np.linalg.norm(points[2] - points[3]),
        )
    )
    crop_height = int(
        max(
            np.linalg.norm(points[0] - points[3]),
            np.linalg.norm(points[1] - points[2]),
        )
    )
    crop_width = max(crop_width, 1)
    crop_height = max(crop_height, 1)

    dst_pts = np.array(
        [
            [0, 0],
            [crop_width, 0],
            [crop_width, crop_height],
            [0, crop_height],
        ],
        dtype=np.float32,
    )

    matrix = cv2.getPerspectiveTransform(points, dst_pts)
    dst = cv2.warpPerspective(
        img,
        matrix,
        (crop_width, crop_height),
        borderMode=cv2.BORDER_REPLICATE,
        flags=cv2.INTER_CUBIC,
    )

    dst_h, dst_w = dst.shape[:2]
    if dst_w > 0 and dst_h / float(dst_w) >= ROTATE_ASPECT_THRESHOLD:
        dst = np.rot90(dst)
    return dst
