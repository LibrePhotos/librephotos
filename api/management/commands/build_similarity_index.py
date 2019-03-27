from django.core.management.base import BaseCommand
from api.models import User
from api.image_similarity import build_image_similarity_index
from api.util import logger

class Command(BaseCommand):
    help = 'Build image similarity index for all users'

    def handle(self, *args, **kwargs):
        for user in User.objects.all():
            build_image_similarity_index(user)


