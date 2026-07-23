import tempfile

from librephotos.logging_bootstrap import build_logging_config

from .production import *  # noqa

DEBUG = True

# The suite has to stay quiet, but it cannot lose the file handler: api.util
# resolves the live rotating handler out of this configuration by name, and a
# NullHandler root would leave it with nothing to find and the rotation tests
# with nothing to assert about. So keep the real handler, point it at a
# throwaway directory instead of the deployment's log directory, and silence it
# with the level rather than by removing it.
#
# LOGS_ROOT moves with the handler rather than staying on BASE_LOGS:
# ServerLogsView serves settings.LOGS_ROOT/ownphotos.log, so leaving the two
# pointing at different directories would let the suite pass while an admin
# downloads a file nothing writes to.
LOGS_ROOT = tempfile.mkdtemp(prefix="librephotos-test-logs-")
LOGGING = build_logging_config(
    logs_root=LOGS_ROOT,
    level="CRITICAL",
    to_console=False,
)
