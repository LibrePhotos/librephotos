import os
import platform
import subprocess
import time
from datetime import timedelta

import requests
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from api.models import Photo
from api.util import logger
from librephotos.logging_bootstrap import DEFAULT_LOG_LEVEL

# Track services that should not be restarted due to system incompatibility
INCOMPATIBLE_SERVICES = set()

# CPU features required for different services
SERVICE_CPU_REQUIREMENTS = {
    "llm": {
        "required": ["avx", "sse4_2"],  # Essential for llama.cpp
        "recommended": ["avx2", "fma", "f16c"],  # Improve performance
    }
}

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
    "ocr": 8012,
}

HTTP_OK = 200


def check_services():
    for service in SERVICES.keys():
        if service in INCOMPATIBLE_SERVICES:
            logger.info(f"Skipping restart of incompatible service: {service}")
            continue

        if not is_healthy(service):
            stop_service(service)
            logger.info(f"Restarting {service}")
            start_service(service)


def is_healthy(service):
    port = SERVICES.get(service)
    try:
        from api.http_timeouts import HEALTH_CHECK

        res = requests.get(f"http://localhost:{port}/health", timeout=HEALTH_CHECK)
        # If response has timestamp, check if it needs to be restarted
        if res.json().get("last_request_time") is not None:
            if res.json()["last_request_time"] < time.time() - 120:
                logger.info(f"Service {service} is stale and needs to be restarted")
                return False
        return res.status_code == HTTP_OK
    except BaseException as e:
        logger.exception(f"Error checking health of {service}: {str(e)}")
        return False


def _service_environment():
    """Environment for the spawned service processes.

    They never load Django, so they configure their logging from BASE_LOGS and
    LOG_LEVEL (see librephotos.logging_bootstrap). Popen without ``env`` would
    pass on only the ambient environment, which does not carry a log location
    set through a settings override rather than an environment variable.

    Their stdout is deliberately left alone. Handing a child an fd on the log
    file would pin it to that inode, so after the first rotation it would keep
    writing to the rotated-away file and the space would never be reclaimed.
    """
    return {
        **os.environ,
        "BASE_LOGS": settings.LOGS_ROOT,
        "LOG_LEVEL": settings.LOGGING.get("root", {}).get("level", DEFAULT_LOG_LEVEL),
    }


def start_service(service):
    # Check system compatibility before attempting to start the service
    if not is_service_compatible(service):
        logger.error(f"Service '{service}' is not compatible with this system")
        return False

    if service == "image_similarity":
        subprocess.Popen(
            ["python", "image_similarity/main.py"], env=_service_environment()
        )
    elif service in SERVICES.keys():
        subprocess.Popen(
            ["python", f"service/{service}/main.py"], env=_service_environment()
        )
    else:
        logger.warning("Unknown service: %s", service)
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


def _is_arm_architecture():
    """Check if the current system is running on ARM architecture

    Returns:
        bool: True if ARM architecture, False otherwise
    """
    machine = platform.machine().lower()
    return machine in ["aarch64", "arm64", "armv7l", "armv8"]


def check_cpu_features():
    """Check for CPU instruction sets for various services

    Note: x86/x64-specific instruction sets (AVX, SSE, etc.) only apply to x86/x64 CPUs.
    On ARM architectures, these checks are skipped as they are not relevant.
    """
    # Check if we're on ARM architecture
    if _is_arm_architecture():
        machine = platform.machine()
        logger.info(
            f"Detected ARM architecture ({machine}), skipping x86-specific CPU feature checks"
        )
        return []  # Return empty list as x86 features don't apply to ARM

    # Features to check for (x86/x64 specific)
    features_to_check = ["avx", "avx2", "sse4_2", "fma", "f16c"]
    available_features = []

    if not available_features:
        try:
            import cpuinfo

            cpu_info = cpuinfo.get_cpu_info()
            flags = cpu_info.get("flags", [])
            for feature in features_to_check:
                if feature in flags:
                    available_features.append(feature)
        except ImportError:
            pass

    return available_features


def has_required_cpu_features(service):
    """Check if CPU has required features for a specific service

    On ARM architectures, x86-specific CPU checks are bypassed since those
    instruction sets don't exist on ARM. Services like llama.cpp support ARM natively.
    """
    if service not in SERVICE_CPU_REQUIREMENTS:
        return True  # No CPU requirements for this service

    # Check if we're on ARM architecture
    if _is_arm_architecture():
        machine = platform.machine()
        logger.info(
            f"Running on ARM architecture ({machine}), skipping x86-specific CPU feature requirements for {service}"
        )
        return True  # Skip x86-specific checks on ARM

    requirements = SERVICE_CPU_REQUIREMENTS[service]
    required_features = requirements.get("required", [])
    recommended_features = requirements.get("recommended", [])

    available_features = check_cpu_features()

    logger.info(f"CPU features detected for {service}: {available_features}")

    missing_required = []
    missing_recommended = []

    for feature in required_features:
        if feature not in available_features:
            missing_required.append(feature)

    for feature in recommended_features:
        if feature not in available_features:
            missing_recommended.append(feature)

    if missing_required:
        logger.error(f"Service '{service}' requires CPU features: {missing_required}")
        logger.error(f"Missing required CPU features: {missing_required}")
        return False

    if missing_recommended:
        logger.warning(
            f"Service '{service}' performance may be degraded without: {missing_recommended}"
        )

    logger.info(f"CPU compatible with service '{service}'")
    return True


def is_service_compatible(service):
    """Check if a service is compatible with the current system"""
    # Check CPU compatibility
    if not has_required_cpu_features(service):
        INCOMPATIBLE_SERVICES.add(service)
        return False

    return True


def cleanup_deleted_photos():
    deleted_photos = Photo.objects.filter(
        Q(removed=True) & Q(last_modified__gte=timezone.now() - timedelta(days=30))
    )
    for photo in deleted_photos:
        photo.delete()
