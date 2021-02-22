from django.contrib.auth.models import AbstractUser
from django.db import models
from django_cryptography.fields import encrypt


class User(AbstractUser):
    scan_directory = models.CharField(max_length=512, db_index=True)
    confidence = models.FloatField(default=0.1, db_index=True)
    avatar = models.ImageField(upload_to='avatars', null=True)

    nextcloud_server_address = models.CharField(
        max_length=200, default=None, null=True)
    nextcloud_username = models.CharField(
        max_length=64, default=None, null=True)
    nextcloud_app_password = encrypt(
        models.CharField(max_length=64, default=None, null=True))
    nextcloud_scan_directory = models.CharField(
        max_length=512, db_index=True, null=True)

def get_admin_user():
    return User.objects.get(is_superuser=True)

def get_deleted_user():
    return User.objects.get_or_create(username='deleted')[0]
