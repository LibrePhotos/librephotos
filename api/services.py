import subprocess

import requests

from api.util import logger

# Define all the services that can be started, with their respective ports
SERVICES = {
    "image_similarity": 8002,
    "thumbnail": 8003,
    "face_recognition": 8005,
    "clip_embeddings": 8006,
    "llm": 8008,
    "image_captioning": 8007,
}


def check_services():
    for service in SERVICES.keys():
        if not is_healthy(service):
            logger.info(f"Starting {service}")
            start_service(service)


def is_healthy(service):
    port = SERVICES.get(service)
    try:
        res = requests.get(f"http://localhost:{port}/health")
        return res.status_code == 200
    except BaseException as e:
        logger.warning(f"Error checking health of {service}: {str(e)}")
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
