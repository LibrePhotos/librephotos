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

running_processes = {}


def check_services():
    for service in running_processes.keys():
        if not is_healthy(service):
            process = running_processes.pop(service)
            process.terminate()
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
        process = subprocess.Popen(
            [
                "python",
                "image_similarity/main.py",
                "2>&1 | tee /logs/image_similarity.log",
            ]
        )
    elif service in SERVICES.keys():
        process = subprocess.Popen(
            [
                "python",
                f"service/{service}/main.py",
                "2>&1 | tee /logs/{service}.log",
            ]
        )
    else:
        logger.warning("Unknown service:", service)
        return False

    running_processes[service] = process
    logger.info(f"Service '{service}' started successfully")
    return True


def stop_service(service):
    if service in running_processes:
        process = running_processes.pop(service)
        process.terminate()
        logger.info(f"Service '{service}' stopped successfully")
        return True
    else:
        logger.warning(f"Service '{service}' is not running")
        return False
