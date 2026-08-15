---
title: "🔑 Single sign-on (OIDC)"
description: "Letting people log in with Keycloak, Authentik, Authelia, Zitadel, Google or any other OpenID Connect provider"
sidebar_position: 2
---

LibrePhotos can hand login over to an external identity provider that speaks
**OpenID Connect** — Keycloak, Authentik, Authelia, Zitadel, Okta, Google, Entra
ID and so on. After the provider confirms who someone is, LibrePhotos issues its
own normal session, so everything downstream behaves exactly as it does for a
password login.

Username-and-password login keeps working alongside it. Turning SSO on does not
take anyone's existing way of logging in away.

## What you need before starting

- **Your server's public URL**, set as the `FRONTEND_BASE_URL` environment
  variable (for example `https://photos.example.com`). This one is not optional.
  The reverse proxy in front of the backend rewrites the `Host` header, so
  LibrePhotos genuinely cannot work out its own public address from an incoming
  request — it has to be told. Without it the login button reports that SSO is
  not fully configured.
- **An email provider configured** in Site Settings, *if* you want LibrePhotos to
  create accounts on first login. See the email settings page. Without email
  configured, LibrePhotos will not create accounts over SSO, because it has no
  way to act on the provider's claim that an address is verified.

## Registering LibrePhotos with your identity provider

Create a **confidential client** (one with a client secret) at your provider and
give it this redirect URI:

```
https://your-librephotos-url/api/accounts/oidc/<provider_id>/login/callback/
```

`<provider_id>` is a short name you choose in the next step — `keycloak`,
`authentik`, `google`, whatever you like. It must match exactly.

Note down the client ID, the client secret, and the provider's **issuer URL** (the
one whose `/.well-known/openid-configuration` document describes it).

## Telling LibrePhotos about the provider

In the Django admin (`/api/django-admin/`), under **Social applications**, add one:

| Field | Value |
| --- | --- |
| Provider | `OpenID Connect` |
| Provider ID | the `<provider_id>` you used in the redirect URI |
| Name | what the login button should say, if you add more than one provider |
| Client id | from your provider |
| Secret key | from your provider |
| Settings | `{"server_url": "https://your-idp/realms/example"}` — the issuer URL |
| Sites | pick your site |

Then, in Site Settings:

- **`OIDC_ENABLED`** — the on/off switch. While it is off, the login button is
  hidden *and* the SSO endpoints are inactive, so switching it off is a real way
  to stop SSO logins.
- **`OIDC_BUTTON_LABEL`** — the text on the login button, e.g. "Sign in with
  Keycloak".
- **`OIDC_ALLOW_SIGNUP`** — whether a first-time SSO login may create a new
  LibrePhotos account. Off by default; also requires email to be configured.

## How accounts are matched up

On a first SSO login, LibrePhotos looks for an existing account whose email
matches the one the provider reports:

- **A single matching account, and the provider says the address is verified** →
  the two are linked, and from then on the provider's stable user id identifies
  that person.
- **The provider has not verified the address** → refused. Otherwise anyone able
  to register your email address at the provider could claim your account.
- **Two accounts share the address, or the provider sends no address** → refused,
  because there is no single right answer.
- **No matching account** → a new one is created only if `OIDC_ALLOW_SIGNUP` is on
  *and* email is configured. Otherwise create the account first (or set its email
  to match) and let the user sign in again.

Accounts created through SSO are never administrators. Grant that in the admin
afterwards if you want it.

## When something goes wrong

A failed attempt returns to the login page with an explanation. The usual causes:

| Message | What to change |
| --- | --- |
| Account not known to LibrePhotos | Create the account, or turn on `OIDC_ALLOW_SIGNUP` |
| Email address not verified | Verify the address at your identity provider |
| Public URL not configured | Set `FRONTEND_BASE_URL` |
| Provider-side "invalid redirect URI" | The redirect URI at your provider must match the callback URL above exactly, including the trailing slash |
