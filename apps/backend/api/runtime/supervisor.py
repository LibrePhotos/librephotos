import logging
import os
import subprocess
import time
from collections.abc import Collection, Iterable
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
from api.runtime.ports import bind_error, port_owner
from api.runtime.sidecars import SERVICES, port_variable, sidecar_url
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

# How long a sidecar that was just started has to answer its health check as
# itself before start_services stops waiting for it (#2324). Loading the
# Python modules of an ML sidecar takes a few seconds on a slow disk.
START_TIMEOUT_SECONDS = 20.0
START_POLL_SECONDS = 0.25

# The address the backend calls the sidecars on (api.runtime.sidecars), so the
# one whose port matters.
LOOPBACK = "127.0.0.1"

# Why each sidecar this process last tried to start did not come up, for the
# Start button's error message.
_start_errors: dict[str, str] = {}

# Errors already logged, so the per-minute watchdog does not repeat a port
# conflict every minute; it is the same until the other program goes away.
_logged_errors: set[str] = set()


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
        body = _sidecar_health(res, service)
        if body is None:
            # Another program on the port that happens to answer /health:
            # healthy for it, useless for us (#2324).
            _log_error_once(
                "Port %s answers but is not LibrePhotos' %s service%s",
                SERVICES[service],
                service,
                _owner_suffix(SERVICES[service]),
            )
            return False
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


def _sidecar_health(response: requests.Response, service: str) -> dict[str, Any] | None:
    """The /health body when it comes from the sidecar named *service*, else None.

    Every sidecar names itself in the ``service`` field (service._common).
    """
    try:
        body = response.json()
    except ValueError:
        return None
    if isinstance(body, dict) and body.get("service") == service:
        return body
    return None


def _answers_as_itself(service: str) -> bool:
    """Whether the sidecar answers its health check right now, as itself.

    Stricter than is_healthy, which also counts a running process that does
    not answer (busy): this one is for a sidecar that was just started.
    """
    from api.runtime.http_timeouts import HEALTH_CHECK

    try:
        response = requests.get(sidecar_url(service, "/health"), timeout=HEALTH_CHECK)
    except requests.RequestException:
        return False
    return (
        response.status_code == HTTP_OK
        and _sidecar_health(response, service) is not None
    )


def _log_error_once(message: str, *args: object) -> None:
    key = message % args
    if key in _logged_errors:
        logger.debug(message, *args)
        return
    _logged_errors.add(key)
    logger.error(message, *args)


def _owner_suffix(port: int) -> str:
    owner = port_owner(port)
    if owner is None:
        return ""
    return f" ({owner.name or 'unknown program'}, process ID {owner.pid})"


def _is_sidecar_process(pid: int, service: str) -> bool:
    import psutil

    try:
        return _is_service_process(psutil.Process(pid).cmdline(), service)
    except psutil.Error:
        return False


def port_conflict(service: str) -> str | None:
    """Why the sidecar cannot listen on its port: another program holds it.

    None when the port is free, or held by this sidecar itself (running, or
    busy and not answering). The text says which program, when the OS tells.
    """
    port = SERVICES[service]
    if bind_error(LOOPBACK, port) is None:
        return None
    owner = port_owner(port)
    if owner is None:
        # The OS does not say who (macOS without root): the sidecar's own
        # process, or its answer, still tell it apart from a stranger.
        if _service_process_running(service) or _answers_as_itself(service):
            return None
        return f"port {port} is used by another program"
    if _is_sidecar_process(owner.pid, service):
        return None
    name = owner.name or "another program"
    return f"port {port} is used by {name} (process ID {owner.pid})"


def start_error(service: str) -> str | None:
    """Why the last start of *service* in this process failed, if it did."""
    return _start_errors.get(service)


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
        # The Vulkan loader skips Mesa's software driver (lavapipe, which the
        # image ships with the Intel and AMD drivers). In a container without
        # the GPU's own driver, WebGPU ran every model on it with no error,
        # about 20 times slower than ONNX Runtime's CPU provider (#2445);
        # without it the session fails and service.onnx_session falls back to
        # the CPU provider. Unless set already.
        "VK_LOADER_DRIVERS_DISABLE": "*lvp*",
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
    """Start one sidecar and wait until it answers; see start_services."""
    return start_services([service])[service]


def start_services(services: Iterable[str]) -> dict[str, bool]:
    """Start the sidecars, then wait until each one answers its health check.

    A sidecar counts as started once it answers as itself. One that exits
    while it is waited for failed, and the log says why: the port and the
    program holding it, when that is the reason (#2324). Popen returning
    said nothing: a sidecar whose port was taken died right away, the log
    said "started successfully", and the watchdog restarted it every minute.

    All of them are started first and waited for together, so the start
    takes as long as the slowest sidecar, not the sum of them. One that is
    still loading after START_TIMEOUT_SECONDS counts as started; the
    watchdog checks it again.
    """
    results: dict[str, bool] = {}
    launched: dict[str, subprocess.Popen[bytes]] = {}
    for service in services:
        _start_errors.pop(service, None)
        if not is_service_enabled(service):
            logger.info(
                "Service '%s' not started: %s", service, disabled_reason(service)
            )
            results[service] = False
            continue
        if service not in SERVICES:
            logger.warning("Unknown service: %s", service)
            results[service] = False
            continue
        if _answers_as_itself(service):
            logger.info("Service '%s' is already running", service)
            results[service] = True
            continue
        conflict = port_conflict(service)
        if conflict is not None:
            _start_failed(service, conflict)
            results[service] = False
            continue
        process = subprocess.Popen(
            _service_command(service), env=_service_environment()
        )
        _processes[service] = process
        launched[service] = process
    results.update(_wait_until_up(launched))
    return results


def _start_failed(service: str, reason: str) -> None:
    _start_errors[service] = reason
    _log_error_once(
        "Service '%s' could not start: %s. Stop that program, or move the "
        "service to a free port with %s",
        service,
        reason,
        port_variable(service),
    )


def _wait_until_up(
    launched: dict[str, subprocess.Popen[bytes]],
) -> dict[str, bool]:
    """Wait for each just started sidecar to answer, exit, or run out of time."""
    results: dict[str, bool] = {}
    pending = dict(launched)
    deadline = time.monotonic() + START_TIMEOUT_SECONDS
    while pending:
        for service, process in list(pending.items()):
            if _answers_as_itself(service):
                logger.info(
                    "Service '%s' started on port %s", service, SERVICES[service]
                )
                results[service] = True
            elif process.poll() is not None:
                results[service] = False
                _exited_during_start(service, process.returncode)
            else:
                continue
            del pending[service]
        if not pending or time.monotonic() >= deadline:
            break
        time.sleep(START_POLL_SECONDS)
    for service in pending:
        logger.warning(
            "Service '%s' has not answered on port %s within %.0f s; it is still "
            "starting, and the watchdog checks it again",
            service,
            SERVICES[service],
            START_TIMEOUT_SECONDS,
        )
        results[service] = True
    return results


def _exited_during_start(service: str, returncode: int) -> None:
    conflict = port_conflict(service)
    if conflict is not None:
        _start_failed(service, conflict)
        return
    _start_errors[service] = f"it exited with code {returncode}"
    logger.error(
        "Service '%s' could not start: it exited with code %s; its own log "
        "lines above say why",
        service,
        returncode,
    )


def stop_service(service: str, only: Collection[int] | None = None) -> bool:
    """Stop every process running the sidecar: SIGTERM, then SIGKILL for any
    still there after STOP_GRACE_SECONDS. With ``only``, just the processes
    among those PIDs: the standalone build's own (#2316).

    psutil rather than `ps | grep | kill`: the standalone build runs on Windows,
    where neither exists, and its sidecars are the binary itself, which no
    "python" pattern would match.
    """
    import psutil

    processes = []
    try:
        for process in psutil.process_iter(["pid", "cmdline"]):
            pid = process.info["pid"]
            if pid == os.getpid() or (only is not None and pid not in only):
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
