import secrets

from faker import Faker

from api.models import User

fake = Faker()


def create_password():
    return secrets.token_urlsafe(10)


def create_user_details(is_admin=False):
    data = {
        "username": fake.user_name(),
        "first_name": fake.first_name(),
        "last_name": fake.last_name(),
        "email": fake.email(),
        "password": create_password(),
        "is_superuser": is_admin,
    }
    if is_admin:
        data["is_superuser"] = True
    return data


def create_test_user(is_admin=False, public_sharing=False):
    return User.objects.create(
        username=fake.user_name(),
        first_name=fake.first_name(),
        last_name=fake.last_name(),
        email=fake.email(),
        password=create_password(),
        public_sharing=public_sharing,
        is_superuser=is_admin,
        is_staff=is_admin,
    )
