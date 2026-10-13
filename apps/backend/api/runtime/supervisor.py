import logging
import os
import subprocess
import time
from typing import Any

import requests
from django.conf import settings
from django.db import DatabaseError

from api.runtime import sidecars
from api.runtime.features import (
    Feature,
    env_flag_name,
    feature_enabled,
    feature_locked,
    site_setting_key,
)
from api.runtime.sidecars import SERVICES, sidecar_url
from librephotos.logging_bootstrap import DEFAULT_LOG_LEVEL
from librephotos.standalone import named_executable

logger = logging.getLogger(__name__)

# apps/backend, three levels above api/runtime/supervisor.py: where
# _service_script's relative paths and the service package live.
BACKEND_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

HTTP_OK = 200

# The feature each service serves; None means core scan/search, always on.
# The tags service runs OpenCLIP, which also makes the semantic-search
# embeddings and query embeddings, so it is core: SCENE_CLASSIFICATION only
# decides whether photos get tags (api.search.semantic).
SERVICE_FEATURES: dict[str, Feature | None] = {
    "image_similarity": None,
    "thumbnail": None,
    "face_recognition": "FACE_DETECTION",
    "image_captioning": "IMAGE_CAPTIONING",
    "exif": None,
    "tags": None,
    "ocr": None,
}

# The environment variable that can lock each service's feature off, which the
# admin Services page shows.
SERVICE_FEATURE_FLAGS = {
    service: None if feature is None else env_flag_name(feature)
    for service, feature in SERVICE_FEATURES.items()
}


def _ocr_model_selected() -> bool:
    """Whether an admin has picked an OCR model in the site settings.

    OCR's switch is a site setting rather than an environment variable, and it
    ships with nothing selected, so the sidecar would otherwise be started on
    every deployment for a feature none of them has turned on. Reusing
    ml_models' notion of "not selected" keeps this gate, the model download and
    the OCR jobs from ever disagreeing about what the value means.

    A configuration the process cannot read counts as selected: the flags fail
    open for the same reason, and a database that is not up yet must not be able
    to take a service away.
    """
    try:
        from constance import config as site_config

        from api.runtime.ml_models import _is_model_not_selected

        return not _is_model_not_selected(site_config.OCR_MODEL)
    except DatabaseError:
        return True


def _captioning_model_selected() -> bool:
    """Whether a captioning model other than "None" is picked (#2218).

    With "None" the captioner is not downloaded, so a sidecar started anyway
    would have nothing to load. Fails open on an unreadable configuration,
    like _ocr_model_selected.
    """
    try:
        from api.runtime.ml_models import captioning_model_selected

        return captioning_model_selected()
    except DatabaseError:
        return True


# Services that also need a site setting to say yes: a model picked for them.
# The per-minute watchdog re-reads these, so selecting an OCR or captioning
# model starts the sidecar without a restart.
SERVICE_SITE_GATES = {
    "ocr": _ocr_model_selected,
    "image_captioning": _captioning_model_selected,
}


def is_service_enabled(service: str) -> bool:
    """Whether this deployment's configuration calls for the service to run.

    The feature's switch is the environment flag and then the site setting
    (api.runtime.features); the per-minute watchdog re-reads it, so turning a
    feature off or on in the site settings stops or starts its sidecar without
    a restart.
    """
    gate = SERVICE_SITE_GATES.get(service)
    if gate is not None and not gate():
        return False

    feature = SERVICE_FEATURES.get(service)
    return feature is None or feature_enabled(feature)


def disabled_reason(service: str) -> str:
    """Why is_service_enabled turned the service down, for a log or an error.

    It names the switch to change: the environment variable when the server
    configuration locked the feature off, else the site setting.
    """
    feature = SERVICE_FEATURES.get(service)
    if feature is not None and feature_locked(feature):
        return f"{env_flag_name(feature)} is disabled in the server environment"
    if feature is not None and not feature_enabled(feature):
        return f"{site_setting_key(feature)} is turned off in the site settings"
    return "no model is selected for it in the site settings"


# The Popen handle of every sidecar this process started. The watchdog runs
# in whichever django-q worker picks up the schedule, and a child that is
# killed stays a zombie until its parent waits for it.
_processes: dict[str, subprocess.Popen[bytes]] = {}

# The last /health body of each sidecar, for the idle check that follows it.
_last_health: dict[str, dict[str, Any]] = {}

# A sidecar with a model loaded and no request for this long is asked to
# unload it: the memory goes back without losing the process.
IDLE_UNLOAD_SECONDS = 120

# How long a sidecar has to exit after SIGTERM before it is killed.
STOP_GRACE_SECONDS = 5


def check_services() -> None:
    _reap_exited()
    for service in SERVICES.keys():
        if not is_service_enabled(service):
            # Silent on purpose: this runs every minute, and startup already
            # logged the reason once.
            continue

        if not is_healthy(service):
            stop_service(service)
            logger.info("Restarting %s", service)
            start_service(service)
        else:
            unload_idle_model(service)


def is_healthy(service: str) -> bool:
    """Whether the sidecar answers its health check (or is busy, see below).

    An idle sidecar is healthy: its memory is reclaimed by unload_idle_model,
    not by a restart.
    """
    _last_health.pop(service, None)
    try:
        from api.runtime.http_timeouts import HEALTH_CHECK

        res = requests.get(sidecar_url(service, "/health"), timeout=HEALTH_CHECK)
        if res.status_code != HTTP_OK:
            return False
        try:
            body = res.json()
        except ValueError:
            body = None
        if isinstance(body, dict):
            _last_health[service] = body
        return True
    except requests.RequestException as e:
        # The sidecars serve one request at a time, and a tag or embedding
        # batch takes far longer than the health probe allows, so a probe that
        # times out or is refused during a scan means "busy" as often as
        # "dead". Restarting a busy sidecar fails the request it was serving
        # and loses that photo's tags or embedding; a process that is still
        # there is left alone, only one that has gone is restarted.
        if _service_process_running(service):
            logger.info(
                "Service %s did not answer its health check but is running: %s",
                service,
                e,
            )
            return True
        logger.warning("Service %s is not running: %s", service, e)
        return False
    except ValueError as e:
        # sidecar_url: a name that is not in SERVICES.
        logger.exception("Error checking health of %s: %s", service, str(e))
        return False


def unload_idle_model(service: str) -> bool:
    """Ask a sidecar idle for IDLE_UNLOAD_SECONDS to unload its model.

    Reads the /health answer is_healthy just got; a sidecar that holds no
    model reports ``model_loaded`` as None and is never asked.
    """
    health = _last_health.pop(service, None) or {}
    last_request_time = health.get("last_request_time")
    if health.get("model_loaded") is not True or last_request_time is None:
        return False
    if health.get("busy"):
        return False
    idle = time.time() - last_request_time
    if idle < IDLE_UNLOAD_SECONDS:
        return False

    from api.runtime.http_timeouts import UNLOAD_MODEL

    try:
        sidecars.get(service, "/unload-model", timeout=UNLOAD_MODEL)
    except requests.RequestException as e:
        logger.warning("Service %s could not unload its model: %s", service, e)
        return False
    logger.info("Service %s idle for %.0f s: unloaded its model", service, idle)
    return True


def _reap_exited() -> None:
    """Collect the exit status of sidecars this process started that ended."""
    for service, process in list(_processes.items()):
        returncode = process.poll()
        if returncode is not None:
            del _processes[service]
            logger.info(
                "Service '%s' (PID %s) exited: %s", service, process.pid, returncode
            )


def _service_process_running(service: str) -> bool:
    import psutil

    for process in psutil.process_iter(["pid", "cmdline"]):
        if _is_service_process(process.info["cmdline"], service):
            return True
    return False


def _service_environment() -> dict[str, str]:
    """Environment for the spawned service processes.

    They never load Django, so they configure their logging from BASE_LOGS and
    LOG_LEVEL (see librephotos.logging_bootstrap) and find their models under
    BASE_DATA/protected_media/data_models, the same root api.runtime.ml_models downloads
    them to. Popen without ``env`` would pass on only the ambient environment,
    which does not carry a location set through a settings override rather
    than an environment variable.

    Their stdout is deliberately left alone. Handing a child an fd on the log
    file would pin it to that inode, so after the first rotation it would keep
    writing to the rotated-away file and the space would never be reclaimed.

    A script has only its own directory on sys.path, so PYTHONPATH leads with
    the backend root: the ML sidecars share service.onnx_session.
    """
    pythonpath = [BACKEND_ROOT]
    if os.environ.get("PYTHONPATH"):
        pythonpath.append(os.environ["PYTHONPATH"])
    return {
        # numpy's OpenBLAS starts a thread per core in every process that
        # imports it and reserves a buffer for each: ~350 MB of committed
        # memory per sidecar on a 12-thread machine. The sidecars do their
        # heavy maths in ONNX Runtime, which has its own threads, and use
        # numpy only for pre- and post-processing. Unless set already.
        "OPENBLAS_NUM_THREADS": "1",
        **os.environ,
        "BASE_DATA": settings.BASE_DATA,
        "BASE_LOGS": settings.LOGS_ROOT,
        "LOG_LEVEL": settings.LOGGING.get("root", {}).get("level", DEFAULT_LOG_LEVEL),
        "PYTHONPATH": os.pathsep.join(pythonpath),
    }


def _service_script(service: str) -> str:
    if service == "image_similarity":
        return "image_similarity/main.py"
    return f"service/{service}/main.py"


def _service_command(service: str) -> list[str]:
    """argv that starts the sidecar.

    From source that is the script under the interpreter on PATH, as the
    Docker images have always done. The standalone build has no interpreter:
    the binary runs the sidecar itself (librephotos.standalone.run_service).
    """
    executable = named_executable(service)
    if executable is not None:
        return [executable, "service", service]
    return ["python", _service_script(service)]


def _is_service_process(cmdline: list[str] | None, service: str) -> bool:
    """Whether a process command line is one _service_command would produce."""
    if not cmdline or len(cmdline) < 2:
        return False
    if cmdline[-2:] == ["service", service]:
        return True
    script = cmdline[-1].replace("\\", "/")
    interpreter = os.path.basename(cmdline[0]).lower()
    return script.endswith(_service_script(service)) and "python" in interpreter


def start_service(service: str) -> bool:
    if not is_service_enabled(service):
        logger.info("Service '%s' not started: %s", service, disabled_reason(service))
        return False

    if service not in SERVICES:
        logger.warning("Unknown service: %s", service)
        return False

    _processes[service] = subprocess.Popen(
        _service_command(service), env=_service_environment()
    )

    logger.info("Service '%s' started successfully", service)
    return True


def stop_service(service: str) -> bool:
    """Stop every process running the sidecar: SIGTERM, then SIGKILL for any
    still there after STOP_GRACE_SECONDS.

    psutil rather than `ps | grep | kill`: the standalone build runs on Windows,
    where neither exists, and its sidecars are the binary itself, which no
    "python" pattern would match.
    """
    import psutil

    processes = []
    try:
        for process in psutil.process_iter(["pid", "cmdline"]):
            if process.info["pid"] == os.getpid():
                continue
            if not _is_service_process(process.info["cmdline"], service):
                continue
            try:
                process.terminate()
                processes.append(process)
            except psutil.NoSuchProcess:
                pass
            except psutil.Error as e:
                logger.error("Failed to stop service '%s': %s", service, e)

        # Waiting on a child also reaps it.
        _, alive = psutil.wait_procs(processes, timeout=STOP_GRACE_SECONDS)
        for process in alive:
            logger.warning(
                "Service '%s' with PID %s ignored SIGTERM for %s s; killing it",
                service,
                process.info["pid"],
                STOP_GRACE_SECONDS,
            )
            try:
                process.kill()
            except psutil.NoSuchProcess:
                pass
        psutil.wait_procs(alive, timeout=STOP_GRACE_SECONDS)
    except (psutil.Error, OSError) as e:
        logger.error("An error occurred while stopping service '%s': %s", service, e)
        return False
    finally:
        handle = _processes.pop(service, None)
        if handle is not None:
            handle.poll()

    for process in processes:
        logger.info(
            "Service '%s' with PID %s stopped successfully",
            service,
            process.info["pid"],
        )
    if not processes:
        logger.warning("Service '%s' is not running", service)
    return bool(processes)
