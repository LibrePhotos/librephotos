import mimetypes

import filetype


def mime_type(path):
    """MIME type from the file's magic bytes, else its extension, else octet-stream."""
    try:
        sniffed = filetype.guess_mime(path)
    except OSError:
        sniffed = None
    return sniffed or mimetypes.guess_type(path)[0] or "application/octet-stream"
