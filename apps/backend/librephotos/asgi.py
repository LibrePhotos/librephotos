"""ASGI entry point for uvicorn.

The app stays WSGI (a2wsgi runs it in a thread pool and streams response chunks
as they are produced); Django's own ASGI handler would buffer every sync
StreamingHttpResponse and FileResponse in memory before sending, which breaks
live video transcoding and range requests.
"""

from a2wsgi import WSGIMiddleware

from librephotos.wsgi import application as wsgi_application

application = WSGIMiddleware(wsgi_application)
