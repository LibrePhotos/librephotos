# Release builds pass their release tag, so the image sits on the base that was
# promoted for that release instead of whatever :dev points at while it builds.
ARG BASE_TAG=dev
FROM reallibrephotos/librephotos-base-gpu:${BASE_TAG}

# Debug flag is more like a dev flag
ARG DEBUG
ARG MLVALIDATION
ARG IMAGE_TAG
ENV IMAGE_TAG ${IMAGE_TAG}

WORKDIR /code
# Build context is the monorepo root; source lives under apps/backend/.
# Requirements go in first, so a source-only change reuses the install layers.
COPY apps/backend/requirements*.txt /code/
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt && \
  python - <<'PY'
from importlib import metadata
import subprocess
import sys

try:
    version = metadata.version("onnxruntime")
except metadata.PackageNotFoundError:
    raise RuntimeError("onnxruntime must be installed from requirements.txt with proper package metadata before switching to onnxruntime-gpu")

subprocess.check_call([sys.executable, "-m", "pip", "uninstall", "-y", "onnxruntime"])
subprocess.check_call([
    sys.executable,
    "-m",
    "pip",
    "install",
    "--no-cache-dir",
    "--break-system-packages",
    f"onnxruntime-gpu=={version}",
])

import onnxruntime as ort

providers = ort.get_available_providers()
print(ort.__version__)
print(providers)
if "CUDAExecutionProvider" not in providers:
    raise RuntimeError(
        f"CUDAExecutionProvider not found in available providers: {providers}. "
        "Check the onnxruntime-gpu install and CUDA runtime libraries in the image."
    )
PY
RUN if [ "$DEBUG" = 1 ] ; then \
  pip install --break-system-packages -r requirements.dev.txt; \
  fi
RUN if [ "$MLVALIDATION" = 1 ] ; then \
  apt-get update && apt-get install default-jre -y; \
  pip install --break-system-packages -r requirements.mlval.txt; \
  fi
COPY apps/backend/ /code/
EXPOSE 8001

# The commit this image was built from, reported by /api/imagetag/ (the image
# ships without .git). Declared last so a new commit does not invalidate the
# dependency layers above.
ARG GIT_HASH
ENV GIT_HASH=${GIT_HASH}

COPY deploy/docker/backend-gpu/entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
