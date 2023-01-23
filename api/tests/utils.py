import secrets


def create_password():
    return secrets.token_urlsafe(10)
