"""Accounts: signing in, who may do what, and what happens to a user.

- ``authentication``: JWT authentication that also reads the ``jwt`` cookie
- ``cookies``: the only code that sets or deletes the auth cookies
- ``permissions``: the DRF permission classes (admin, superuser, owner, shared)
- ``throttling``: rate limits of the endpoints that take credentials
- ``adapters``: the django-allauth adapters (the OIDC/SSO login policy)
- ``deletion``: what deleting a user does before ``deleted`` takes over
- ``public_url``: the public base URL of the installation (links, redirects)
- ``mail``: the database-backed outgoing email backend
"""
