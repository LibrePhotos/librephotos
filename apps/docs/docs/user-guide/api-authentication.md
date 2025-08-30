---
id: api-authentication
title: API authentication
sidebar_label: API authentication
description: How to authenticate against the LibrePhotos API (JWT and Basic auth)
---

LibrePhotos secures most API endpoints and requires authentication by default. If you see 401 Unauthorized or 403 Forbidden responses when calling API endpoints, you likely need to authenticate using one of the supported methods below.

### Authentication methods

- JWT (recommended): Obtain a short-lived access token via `/api/auth/token/obtain/` and present it as a Bearer token. The obtain and refresh endpoints also set a `jwt` cookie that the browser can reuse.
- Basic authentication: For simple scripts or local testing, you can use HTTP Basic auth. Do not use Basic auth across untrusted networks.

Session authentication is not enabled for API endpoints. The frontend uses JWT behind the scenes, not Django sessions.

### Obtain a JWT access token

Request an access token using your LibrePhotos username and password:

```bash
curl -X POST "http://<backend>/api/auth/token/obtain/" \
  -H 'Content-Type: application/json' \
  -d '{"username":"myuser","password":"mypassword"}'
```

You will receive a JSON response with `access` and `refresh` tokens. The response also sets a `jwt` cookie with the access token for browser use.

Example response:

```json
{
  "refresh": "<refresh_token>",
  "access": "<access_token>"
}
```

Refresh the access token when it expires using:

```bash
curl -X POST "http://<backend>/api/auth/token/refresh/" \
  -H 'Content-Type: application/json' \
  -d '{"refresh":"<refresh_token>"}'
```

### Call APIs using the JWT access token

Include the token in the `Authorization` header:

```bash
curl -H 'Authorization: Bearer <access_token>' \
  "http://<backend>/api/photos/"
```

If you are in a browser environment and already called the token endpoints, the `jwt` cookie will be set and used automatically by the backend for relevant media endpoints. For pure API calls, prefer the Authorization header.

### Call APIs using Basic auth (optional)

```bash
curl -u myuser:mypassword "http://<backend>/api/photos/"
```

### Helpful endpoints

- API help: `http://<backend>/api/help` returns a structured JSON with authentication instructions and example `curl` commands.
- OpenAPI/Swagger (development builds with DEBUG enabled):
  - Schema: `http://<backend>/api/schema`
  - Swagger UI: `http://<backend>/api/swagger`
  - Redoc: `http://<backend>/api/redoc`

### Troubleshooting 401/403

- Ensure you are including `Authorization: Bearer <access_token>` or using Basic auth.
- Verify the access token is current; refresh if needed.
- If testing cross-origin from a separate frontend, ensure CORS and credentials are configured properly and that cookies are allowed if relying on the `jwt` cookie.


