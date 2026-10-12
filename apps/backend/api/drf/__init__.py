"""REST plumbing the views and serializers share.

- ``params``: reading the query string and body through a serializer
  (``parse_query``, ``parse_body`` and the lenient fields)
- ``request_data``: the request body as a key/value object (``request_dict``)
- ``request_user``: the signed-in user, typed as ``User`` (401 if anonymous)
- ``exceptions``: the API exceptions DRF has no class for
- ``pagination``: the one pagination style of every list endpoint
- ``openapi``: the OpenAPI schema class and the schema postprocessing hook

The exception handler that writes every error body is
``api.views.exception_handler``.
"""
