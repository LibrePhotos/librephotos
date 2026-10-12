---
id: api-authentication
title: API authentication
sidebar_label: API authentication
description: How to authenticate against the LibrePhotos API (JWT and Basic auth)
sidebar_position: 24
---

LibrePhotos secures most API endpoints and requires authentication by default. If you see 401 Unauthorized or 403 Forbidden responses when calling API endpoints, you likely need to authenticate using one of the supported methods below.

### Authentication methods

- JWT (recommended): Obtain a short-lived access token via `/api/auth/token/obtain/` and present it as a Bearer token. The obtain and refresh endpoints also set an `HttpOnly` `jwt` cookie that the browser can reuse (see [Cookie flags](#cookie-flags)).
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

The response also clears the `jwt`, `access` and `refresh` cookies, whatever the blacklist answers: a refresh token that is already blacklisted (401), expired, or missing from the body (400) still signs the browser out. The web app calls the endpoint on every logout, because the `jwt` cookie is `HttpOnly` and only the server can delete it. Clearing the cookie does not revoke the access token in it: a copy taken before logout keeps working until it expires.

*Not released yet: up to 1.3.0, the endpoint only blacklisted the token and the web deleted the cookies itself.*

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
Releases before 1.2.0 read only the cookie on the media endpoints and ignore the header there. The cookie works on every version.
:::

From a script, capture the cookie when you obtain the token and replay it:

```bash
curl -c cookies.txt -X POST "http://<backend>/api/auth/token/obtain/" \
  -H 'Content-Type: application/json' \
  -d '{"username":"myuser","password":"mypassword"}'

curl -b cookies.txt "http://<backend>/media/photos/<image_hash>" -o photo.jpg
```

or send it explicitly with `-H "Cookie: jwt=<access_token>"`. The cookie carries the short-lived access token, so refresh it the same way you refresh the header token.

### Cookie flags

The backend sets these cookies:

| Cookie | Set by | Flags |
| --- | --- | --- |
| `jwt` | `/api/auth/token/obtain/`, `/api/auth/token/refresh/`, the SSO login | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` (see below) |
| `access`, `refresh` | the SSO login only (the web app sets them itself after a password login) | `SameSite=Lax`, `Path=/`, `Secure` (see below); not `HttpOnly`, because the web app reads them to send them as bearer tokens |

`HttpOnly` keeps the `jwt` cookie away from scripts on the page; only the server reads it. `SameSite=Lax` still sends the cookies on top-level navigations and on `<img>` and `<video>` requests from the same site, which is all the media endpoints need, and keeps them off requests other sites trigger. Ports do not count, so a web app on `localhost:3000` and a backend on `localhost:8001` are the same site.

The cookies are `Secure` (sent over HTTPS only) when the request reached the backend over HTTPS, or when `AUTH_COOKIE_SECURE` is on. Behind the bundled proxy the backend always sees plain HTTP, also when your own proxy in front of it terminates TLS: it does not trust a forwarded scheme (Django's `SECURE_PROXY_SSL_HEADER` is not set). If your users reach LibrePhotos only over HTTPS, set `AUTH_COOKIE_SECURE=1`; see [Secure auth cookies](../installation/environment-variables.md#secure-auth-cookies). Leave it off when the install is also reached over plain HTTP, such as on the LAN: browsers refuse a `Secure` cookie there, and media would stop loading.

*Not released yet: up to 1.3.0, the cookies had no `HttpOnly`, `SameSite` or `Secure` flag.*

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

Without a development build, read the OpenAPI schema from the repository: [`apps/backend/openapi.json`](https://github.com/LibrePhotos/librephotos/blob/dev/apps/backend/openapi.json) is generated from the code and kept current by CI (on the `dev` branch; not in a release yet). Load it into any OpenAPI viewer, such as the Swagger Editor.

### Error responses

Every API error (a status of 400 or above) has the same JSON body:

```json
{
  "errors": [{ "field": "new_password", "message": "This password is too short.", "code": "weak_password" }]
}
```

- `field` names the request field at fault, or is `non_field_errors` or `detail` when the error is about the request as a whole.
- `message` is meant for people and may change between releases. Do not compare it in code.
- `code` is meant for programs. Most errors carry DRF's generic codes (`invalid`, `not_found`, `permission_denied`, `not_authenticated`, `parse_error`, `throttled`); the ones a client is expected to act on have their own:

| Code                  | Status | Endpoint                                                    | Meaning                                                                                                                                     |
| --------------------- | ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_cursor`      | 400    | `/api/sync/*`                                               | The `cursor` cannot be decoded.                                                                                                             |
| `cursor_expired`      | 410    | `/api/sync/*`                                               | The cursor is older than the deletion log; pull again without one.                                                                          |
| `weak_password`       | 400    | `/api/auth/password/reset/confirm/`                         | The password validators refused the new password; the link is still good.                                                                   |
| `invalid_reset_link`  | 400    | `/api/auth/password/reset/confirm/`                         | The link was used already, expired or was mangled.                                                                                          |
| `model_downloading`   | 503    | `/api/photosedit/generateim2txt/`                           | The captioning model is being downloaded; retry after the `Retry-After` seconds.                                                            |
| `email_send_failed`   | 502    | `/api/email-config/test/`                                   | The mail server refused the test email; `message` is its own answer.                                                                        |
| `job_start_failed`    | 500    | job endpoints (`/api/scanphotos/`, `/api/trainfaces/`, ...) | The background job could not be queued.                                                                                                     |
| `job_already_running` | 409    | job endpoints (`/api/scanphotos/`, `/api/trainfaces/`, ...) | A job of this kind is already queued or running for you. The entry also carries that job's `job_id`; follow it instead of starting another. |

Development builds append an extra entry with `field` `auth` (code `authentication_help`) to a 401 or 403; read the first entry. Media file requests (`/media/...`) are the exception: they answer without a body, as described above.

Not released yet: before the release after 1.3.0, a second start of a job that was still queued queued it again instead of answering `job_already_running`, and duplicate and stack detection (`/api/duplicates/detect`, `/api/stacks/detect/`) answered without a `job_id`. Many endpoints answered errors as `{"error": "..."}` or `{"status": false, "message": "..."}`, entries had no `code`, and three failures (face training that could not be queued, the captioning model download and a refused test email) answered with a 200.

### Troubleshooting 401/403

- Ensure you are including `Authorization: Bearer <access_token>` or using Basic auth.
- Verify the access token is current; refresh if needed.
- A 403 from `/media/...` carrying an `X-Media-Error: authentication` header means the request had no usable credential: send a current bearer token or `jwt` cookie (see [Endpoints that also accept the `jwt` cookie](#endpoints-that-also-accept-the-jwt-cookie)). A 404 there means you are signed in but may not see that photo.
- If testing cross-origin from a separate frontend, ensure CORS and credentials are configured properly and that cookies are allowed if relying on the `jwt` cookie.


