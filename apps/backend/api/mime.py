import mimetypes

import filetype


def _is_mpeg_ts(path):
    """filetype has no MPEG transport stream matcher; AVCHD camcorders (.MTS) need one."""
    try:
        with open(path, "rb") as handle:
            head = handle.read(188 * 3)
    except OSError:
        return False
    return len(head) == 188 * 3 and all(head[i] == 0x47 for i in (0, 188, 376))


def sniffed_mime_type(path):
    """MIME type from the file's magic bytes, or None when nothing recognises them."""
    try:
        sniffed = filetype.guess_mime(path)
    except OSError:
        return None
    if sniffed is None and _is_mpeg_ts(path):
        return "video/mp2t"
    return sniffed


def mime_type(path):
    """MIME type from the file's magic bytes, else its extension, else octet-stream."""
    return (
        sniffed_mime_type(path)
        or mimetypes.guess_type(path)[0]
        or "application/octet-stream"
    )
