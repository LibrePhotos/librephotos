import os
import subprocess
import time
from datetime import timedelta

import requests
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from api import sidecars
from api.models import Photo
from api.sidecars import SERVICES, sidecar_url
from api.util import logger
from librephotos.logging_bootstrap import DEFAULT_LOG_LEVEL
from librephotos.standalone import named_executable

# apps/backend: where _service_script's relative paths and the service package live.
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HTTP_OK = 200

# The feature flag each service serves; None means core scan/search, always on.
SERVICE_FEATURE_FLAGS = {
    "image_similarity": None,
    "thumbnail": None,
    "face_recognition": "FEATURE_FACE_DETECTION",
    "clip_embeddings": None,
    "image_captioning": "FEATURE_IMAGE_CAPTIONING",
    "exif": None,
    "tags": "FEATURE_SCENE_CLASSIFICATION",
    "ocr": None,
}


def _ocr_model_selected():
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

        from api.ml_models import _is_model_not_selected

        return not _is_model_not_selected(site_config.OCR_MODEL)
    except Exception:
        return True


# Services whose switch is a site setting rather than an environment flag. The
# per-minute watchdog re-reads these, so selecting an OCR model starts the
# sidecar without a restart.
SERVICE_SITE_GATES = {"ocr": _ocr_model_selected}


def is_service_enabled(service):
    """Whether this deployment's configuration calls for the service to run.

    A flag the settings module does not define counts as enabled, so an
    unrecognised switch can never take a service away from a deployment that
    had it before.
    """
    gate = SERVICE_SITE_GATES.get(service)
    if gate is not None and not gate():
        return False

    flag = SERVICE_FEATURE_FLAGS.get(service)
    if flag is None:
        return True
    return bool(getattr(settings, flag, True))


def disabled_reason(service):
    """Why is_service_enabled turned the service down, for a log or an error."""
    flag = SERVICE_FEATURE_FLAGS.get(service)
    if flag is not None and not bool(getattr(settings, flag, True)):
        return f"{flag} is disabled"
    return "no model is selected for it in the site settings"


# The Popen handle of every sidecar this process started. The watchdog runs
# in whichever django-q worker picks up the schedule, and a child that is
# killed stays a zombie until its parent waits for it.
_processes = {}

# The last /health body of each sidecar, for the idle check that follows it.
_last_health = {}

# A sidecar with a model loaded and no request for this long is asked to
# unload it: the memory goes back without losing the process.
IDLE_UNLOAD_SECONDS = 120

# How long a sidecar has to exit after SIGTERM before it is killed.
STOP_GRACE_SECONDS = 5


def check_services():
    _reap_exited()
    for service in SERVICES.keys():
        if not is_service_enabled(service):
            # Silent on purpose: this runs every minute, and startup already
            # logged the reason once.
            continue

        if not is_healthy(service):
            stop_service(service)
            logger.info(f"Restarting {service}")
            start_service(service)
        else:
            unload_idle_model(service)


def is_healthy(service):
    """Whether the sidecar answers its health check (or is busy, see below).

    An idle sidecar is healthy: its memory is reclaimed by unload_idle_model,
    not by a restart.
    """
    _last_health.pop(service, None)
    try:
        from api.http_timeouts import HEALTH_CHECK

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
                f"Service {service} did not answer its health check but is running: {e}"
            )
            return True
        logger.warning(f"Service {service} is not running: {e}")
        return False
    except Exception as e:
        logger.exception(f"Error checking health of {service}: {str(e)}")
        return False


def unload_idle_model(service):
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

    from api.http_timeouts import UNLOAD_MODEL

    try:
        sidecars.get(service, "/unload-model", timeout=UNLOAD_MODEL)
    except requests.RequestException as e:
        logger.warning(f"Service {service} could not unload its model: {e}")
        return False
    logger.info(f"Service {service} idle for {idle:.0f} s: unloaded its model")
    return True


def _reap_exited():
    """Collect the exit status of sidecars this process started that ended."""
    for service, process in list(_processes.items()):
        returncode = process.poll()
        if returncode is not None:
            del _processes[service]
            logger.info(f"Service '{service}' (PID {process.pid}) exited: {returncode}")


def _service_process_running(service):
    import psutil

    for process in psutil.process_iter(["pid", "cmdline"]):
        if _is_service_process(process.info["cmdline"], service):
            return True
    return False


def _service_environment():
    """Environment for the spawned service processes.

    They never load Django, so they configure their logging from BASE_LOGS and
    LOG_LEVEL (see librephotos.logging_bootstrap) and find their models under
    BASE_DATA/protected_media/data_models, the same root api.ml_models downloads
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
        **os.environ,
        "BASE_DATA": settings.BASE_DATA,
        "BASE_LOGS": settings.LOGS_ROOT,
        "LOG_LEVEL": settings.LOGGING.get("root", {}).get("level", DEFAULT_LOG_LEVEL),
        "PYTHONPATH": os.pathsep.join(pythonpath),
    }


def _service_script(service):
    if service == "image_similarity":
        return "image_similarity/main.py"
    return f"service/{service}/main.py"


def _service_command(service):
    """argv that starts the sidecar.

    From source that is the script under the interpreter on PATH, as the
    Docker images have always done. The standalone build has no interpreter:
    the binary runs the sidecar itself (librephotos.standalone.run_service).
    """
    executable = named_executable(service)
    if executable is not None:
        return [executable, "service", service]
    return ["python", _service_script(service)]


def _is_service_process(cmdline, service):
    """Whether a process command line is one _service_command would produce."""
    if not cmdline or len(cmdline) < 2:
        return False
    if cmdline[-2:] == ["service", service]:
        return True
    script = cmdline[-1].replace("\\", "/")
    interpreter = os.path.basename(cmdline[0]).lower()
    return script.endswith(_service_script(service)) and "python" in interpreter


def start_service(service):
    if not is_service_enabled(service):
        logger.info("Service '%s' not started: %s", service, disabled_reason(service))
        return False

    if service not in SERVICES:
        logger.warning("Unknown service: %s", service)
        return False

    _processes[service] = subprocess.Popen(
        _service_command(service), env=_service_environment()
    )

    logger.info(f"Service '{service}' started successfully")
    return True


def stop_service(service):
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
                logger.error(f"Failed to stop service '{service}': {e}")

        # Waiting on a child also reaps it.
        _, alive = psutil.wait_procs(processes, timeout=STOP_GRACE_SECONDS)
        for process in alive:
            logger.warning(
                f"Service '{service}' with PID {process.info['pid']} ignored "
                f"SIGTERM for {STOP_GRACE_SECONDS} s; killing it"
            )
            try:
                process.kill()
            except psutil.NoSuchProcess:
                pass
        psutil.wait_procs(alive, timeout=STOP_GRACE_SECONDS)
    except Exception as e:
        logger.error(f"An error occurred while stopping service '{service}': {e}")
        return False
    finally:
        handle = _processes.pop(service, None)
        if handle is not None:
            handle.poll()

    for process in processes:
        logger.info(
            f"Service '{service}' with PID {process.info['pid']} stopped successfully"
        )
    if not processes:
        logger.warning("Service '%s' is not running", service)
    return bool(processes)


def cleanup_deleted_photos():
    deleted_photos = Photo.objects.filter(
        Q(removed=True) & Q(last_modified__lte=timezone.now() - timedelta(days=30))
    )
    for photo in deleted_photos:
        photo.delete()


def prune_deletion_log():
    """Drop tombstones past the mobile-v2 sync horizon (doc 04 §2).

    A client whose cursor predates the oldest surviving tombstone can no longer
    trust the delta feed to tell it what was deleted, so it must reseed; the
    sync endpoints answer such a cursor with ``410 cursor_expired``. Keeping
    tombstones beyond that horizon only grows the table.
    """
    from api.models import DeletionLog

    horizon = timezone.now() - timedelta(days=DeletionLog.PRUNE_HORIZON_DAYS)
    deleted, _ = DeletionLog.objects.filter(deleted_at__lt=horizon).delete()
    return deleted
