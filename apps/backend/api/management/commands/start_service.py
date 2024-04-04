import subprocess

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Start one of the services."

    # Define all the services that can be started
    def add_arguments(self, parser):
        parser.add_argument(
            "service",
            type=str,
            help="The service to start",
            choices=[
                "image_similarity",
                "thumbnail",
                "face_recognition",
                "clip_embeddings",
                "image_captioning",
                "llm",
            ],
        )

    def handle(self, *args, **kwargs):
        service = kwargs["service"]

        if service == "image_similarity":
            subprocess.Popen(
                [
                    "python",
                    "image_similarity/main.py",
                    "2>&1 | tee /logs/image_similarity.log",
                ]
            )
        elif service == "thumbnail":
            subprocess.Popen(
                [
                    "python",
                    "service/thumbnail/main.py",
                    "2>&1 | tee /logs/thumbnail.log",
                ]
            )
        elif service == "face_recognition":
            subprocess.Popen(
                [
                    "python",
                    "service/face_recognition/main.py",
                    "2>&1 | tee /logs/face_recognition.log",
                ]
            )
        elif service == "clip_embeddings":
            subprocess.Popen(
                [
                    "python",
                    "service/clip_embeddings/main.py",
                    "2>&1 | tee /logs/clip_embeddings.log",
                ]
            )
        elif service == "image_captioning":
            subprocess.Popen(
                [
                    "python",
                    "service/image_captioning/main.py",
                    "2>&1 | tee /logs/image_captioning.log",
                ]
            )
        elif service == "llm":
            subprocess.Popen(
                ["python", "service/llm/main.py", "2>&1 | tee /logs/llm.log"]
            )
