---
id: api-authentication
title: API authentication
sidebar_label: API authentication
description: How to authenticate against the LibrePhotos API (JWT and Basic auth)
sidebar_position: 24
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

Access tokens are short-lived and expire after 5 minutes; refresh tokens are valid for 7 days by default. Refreshing returns a new `access` token only, so keep reusing the same `refresh` token until it expires. A long-running script should refresh at least every 5 minutes, or simply retry once against `/api/auth/token/refresh/` whenever a call returns 401. The access-token lifetime is fixed; the refresh-token lifetime can be changed with the `REFRESH_TOKEN_DAYS` environment variable on the backend container.

### Revoke a refresh token (logout)

To invalidate a refresh token — on logout, or to revoke one you think has leaked — blacklist it:

```bash
curl -X POST "http://<backend>/api/auth/token/blacklist/" \
  -H 'Content-Type: application/json' \
  -d '{"refresh":"<refresh_token>"}'
```

No `Authorization` header is needed; the refresh token itself is the credential. On success you get HTTP 200 with an empty JSON body. Blacklisting stops the refresh token from minting new access tokens, but any access token it has already issued stays valid until it expires (5 minutes by default), so revocation is not instantaneous. This is the same endpoint the web frontend calls when you log out.

### Call APIs using the JWT access token

Include the token in the `Authorization` header:

```bash
curl -H 'Authorization: Bearer <access_token>' \
  "http://<backend>/api/photos/"
```

In a browser, the `jwt` cookie set by the obtain and refresh endpoints is sent automatically, which is how `<img>` and `<video>` requests for media authenticate. For the standard JSON endpoints the frontend adds an `Authorization: Bearer` header, just as a script would, and those endpoints ignore the cookie. A few endpoints accept the cookie as well — see [Endpoints that also accept the `jwt` cookie](#endpoints-that-also-accept-the-jwt-cookie) below.

### Endpoints that also accept the `jwt` cookie

These endpoints accept an `Authorization: Bearer <access_token>` header like every other endpoint, and fall back to the `jwt` cookie when there is no bearer header. When both are sent, the header wins:

- Media files — `GET /media/photos/<image_hash>` (originals), plus the thumbnail, square-thumbnail, face-crop, avatar and embedded-media paths (`/media/thumbnails_big/...`, `/media/square_thumbnails/...`, `/media/faces/...`, `/media/avatars/...`, `/media/embedded_media/...`) and generated archives at `/media/zip/<name>`. Basic auth (`curl -u user:pass`) works here too.
- Chunked uploads — `POST /api/upload/` and `POST /api/upload/complete/`.

Media belonging to an active public or shared album, and photos made public, are served without any credential. An expired or otherwise unusable cookie counts as no credential there: public media is still served, and anything else answers 403 with an `X-Media-Error: authentication` header, telling you to sign in again. An invalid bearer *header* answers 401, as on every other endpoint.

:::note
Servers released before this change read only the cookie on the media endpoints and ignore the header there. The cookie works on every version.
:::

From a script, capture the cookie when you obtain the token and replay it:

```bash
curl -c cookies.txt -X POST "http://<backend>/api/auth/token/obtain/" \
  -H 'Content-Type: application/json' \
  -d '{"username":"myuser","password":"mypassword"}'

curl -b cookies.txt "http://<backend>/media/photos/<image_hash>" -o photo.jpg
```

or send it explicitly with `-H "Cookie: jwt=<access_token>"`. The cookie carries the short-lived access token, so refresh it the same way you refresh the header token.

### Call APIs using Basic auth (optional)

```bash
curl -u myuser:mypassword "http://<backend>/api/photos/"
```

Basic auth works on the standard DRF endpoints and on the media endpoints, but not on the chunked uploads.

### Helpful endpoints

These routes are only registered when the backend runs with `DEBUG=1` (development builds). The standard docker-compose deployment runs with `DEBUG=0`, where they all return 404:

- API help: `http://<backend>/api/help` — structured JSON with authentication instructions and example `curl` commands.
- Schema: `http://<backend>/api/schema`
- Swagger UI: `http://<backend>/api/swagger`
- Redoc: `http://<backend>/api/redoc`

For the same reason, the extra `auth` hint that development builds append to a 401/403 error body is not present on a production install, so a production 401 will not point you at `/api/help`.

### Troubleshooting 401/403

- Ensure you are including `Authorization: Bearer <access_token>` or using Basic auth.
- Verify the access token is current; refresh if needed.
- A 403 from `/media/...` carrying an `X-Media-Error: authentication` header means the request had no usable credential: send a current bearer token or `jwt` cookie (see [Endpoints that also accept the `jwt` cookie](#endpoints-that-also-accept-the-jwt-cookie)). A 404 there means you are signed in but may not see that photo.
- If testing cross-origin from a separate frontend, ensure CORS and credentials are configured properly and that cookies are allowed if relying on the `jwt` cookie.


