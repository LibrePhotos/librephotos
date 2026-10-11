"""
Exceptions raised by django-chunked-upload.
"""


class ChunkedUploadError(Exception):
    """
    Exception raised if errors in the request/process.
    """

    def __init__(self, status: int, **data: object) -> None:
        self.status_code = status
        self.data = data
