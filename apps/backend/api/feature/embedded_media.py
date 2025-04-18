import os
from mmap import ACCESS_READ, mmap

import magic
from django.conf import settings

JPEG_EOI_MARKER = b"\xff\xd9"
GOOGLE_PIXEL_MOTION_PHOTO_MP4_SIGNATURES = [b"ftypmp42", b"ftypisom", b"ftypiso2"]

# in reality Samsung motion photo marker will look something like this
# ........Image_UTC_Data1458170015363SEFHe...........#...#.......SEFT..0.....MotionPhoto_Data
# but we are interested only in the content of the video which is right after MotionPhoto_Data
SAMSUNG_MOTION_PHOTO_MARKER = b"MotionPhoto_Data"


def _locate_embedded_video_google(data):
    signatures = GOOGLE_PIXEL_MOTION_PHOTO_MP4_SIGNATURES
    for signature in signatures:
        position = data.find(signature)
        if position != -1:
            return position - 4
    return -1


def _locate_embedded_video_samsung(data):
    position = data.find(SAMSUNG_MOTION_PHOTO_MARKER)
    if position != -1:
        return position + len(SAMSUNG_MOTION_PHOTO_MARKER)
    return -1


def has_embedded_media(path: str) -> bool:
    mime = magic.Magic(mime=True)
    mime_type = mime.from_file(path)
    if mime_type != "image/jpeg":
        return False
    with open(path, "rb") as image:
        with mmap(image.fileno(), 0, access=ACCESS_READ) as mm:
            return (
                _locate_embedded_video_samsung(mm) != -1
                or _locate_embedded_video_google(mm) != -1
            )


def extract_embedded_media(path: str, hash: str) -> str | None:
    with open(str(path), "rb") as image:
        with mmap(image.fileno(), 0, access=ACCESS_READ) as mm:
            position = _locate_embedded_video_google(
                mm
            ) or _locate_embedded_video_google(mm)
            if position == -1:
                return None
            output_dir = f"{settings.MEDIA_ROOT}/embedded_media"
            if not os.path.exists(output_dir):
                os.makedirs(output_dir)
            output_path = f"{output_dir}/{hash}_1.mp4"
            with open(output_path, "wb+") as video:
                mm.seek(position)
                data = mm.read(mm.size())
                video.write(data)
            return output_path
