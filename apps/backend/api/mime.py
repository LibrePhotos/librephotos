import mimetypes

import filetype


def sniffed_mime_type(path):
    """MIME type from the file's magic bytes, or None when nothing recognises them."""
    try:
        return filetype.guess_mime(path)
    except OSError:
        return None


def mime_type(path):
    """MIME type from the file's magic bytes, else its extension, else octet-stream."""
    return (
        sniffed_mime_type(path)
        or mimetypes.guess_type(path)[0]
        or "application/octet-stream"
    )
