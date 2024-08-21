import subprocess
import time
from datetime import timedelta

import requests
from django.db.models import Q
from django.utils import timezone

from api.models import Photo
from api.util import logger

# Define all the services that can be started, with their respective ports
SERVICES = {
    "image_similarity": 8002,
    "thumbnail": 8003,
    "face_recognition": 8005,
    "clip_embeddings": 8006,
    "llm": 8008,
    "image_captioning": 8007,
    "exif": 8010,
    "tags": 8011,
}


def check_services():
    for service in SERVICES.keys():
        if not is_healthy(service):
            stop_service(service)
            logger.info(f"Restarting {service}")
            start_service(service)


def is_healthy(service):
    port = SERVICES.get(service)
    try:
        res = requests.get(f"http://localhost:{port}/health")
        # If response has timestamp, check if it needs to be restarted
        if res.json().get("last_request_time") is not None:
            if res.json()["last_request_time"] < time.time() - 120:
                logger.info(f"Service {service} is stale and needs to be restarted")
                return False
        return res.status_code == 200
    except BaseException as e:
        logger.exception(f"Error checking health of {service}: {str(e)}")
        return False


def start_service(service):
    if service == "image_similarity":
        subprocess.Popen(
            [
                "python",
                "image_similarity/main.py",
                "2>&1 | tee /logs/image_similarity.log",
            ]
        )
    elif service in SERVICES.keys():
        subprocess.Popen(
            [
                "python",
                f"service/{service}/main.py",
                "2>&1 | tee /logs/{service}.log",
            ]
        )
    else:
        logger.warning("Unknown service:", service)
        return False

    logger.info(f"Service '{service}' started successfully")
    return True


def stop_service(service):
    try:
        # Find the process ID (PID) of the service using `ps` and `grep`
        ps_command = f"ps aux | grep '[p]ython.*{service}/main.py' | awk '{{print $2}}'"
        result = subprocess.run(
            ps_command,
            shell=True,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        pids = result.stdout.decode().strip().split()

        if not pids:
            logger.warning("Service '%s' is not running", service)
            return False

        # Kill each process found
        for pid in pids:
            subprocess.run(["kill", "-9", pid], check=True)
            logger.info(f"Service '{service}' with PID {pid} stopped successfully")

        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to stop service '{service}': {e.stderr.decode().strip()}")
        return False
    except Exception as e:
        logger.error(f"An error occurred while stopping service '{service}': {e}")
        return False


def cleanup_deleted_photos():
    deleted_photos = Photo.objects.filter(
        Q(removed=True) & Q(last_modified__gte=timezone.now() - timedelta(days=30))
    )
    for photo in deleted_photos:
        photo.delete()
