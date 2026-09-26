# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/LibrePhotos/librephotos/security/advisories/new),
which is enabled on this repository. The report is visible only to the
maintainers until a fix is published, and it lets us credit you in the
advisory.

If you cannot use that form, say so in a normal issue **without any details of
the vulnerability**, and a maintainer will arrange another channel.

### What to include

Whatever you have — a partial report is better than none:

- What an attacker can do, and what they need in order to do it (an account on
  the instance, a share link, network access to the host, nothing at all).
- Steps to reproduce, ideally against a fresh install.
- The affected version and how it is deployed (Docker, Kubernetes, the Windows
  build, from source), since some issues only exist in one deployment path.
- Which component it is in, if you know: `apps/backend`, `apps/frontend`,
  `apps/mobile`, or the deployment configuration under `deploy/`.

### What to expect

LibrePhotos is maintained by volunteers, so we cannot promise a fixed
response time. We will acknowledge your report, tell you whether we consider
it a vulnerability, and let you know when a fix ships.

## Supported versions

Fixes land on `dev` and reach users in the next release. Only the latest
release is supported — please confirm an issue against a current version
before reporting it.

## Scope

In scope: anything in this repository, including the backend, the web and
mobile clients, and the deployment tooling under `deploy/`.

Out of scope:

- Vulnerabilities in third-party dependencies, unless LibrePhotos uses the
  dependency in a way that makes it exploitable here. Report those upstream.
- Findings that require an attacker to already have administrator access to
  the instance or to the host.
- Reports from automated scanners with no demonstrated impact.

A LibrePhotos instance exposed directly to the internet without a reverse
proxy, TLS, or authentication in front of it is a deployment choice rather
than a vulnerability in the software — but if you find a way to reach another
user's photos on a correctly deployed instance, that is very much in scope,
and we want to hear about it.
