FROM reallibrephotos/librephotos-base-gpu:dev

# Debug flag is more like a dev flag
ARG DEBUG
ARG MLVALIDATION
ARG IMAGE_TAG
ENV IMAGE_TAG ${IMAGE_TAG}

WORKDIR /code
RUN git clone --depth 1 https://github.com/LibrePhotos/librephotos .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt && \
  python - <<'PY'
from importlib import metadata
import subprocess
import sys

try:
    version = metadata.version("onnxruntime")
except metadata.PackageNotFoundError:
    raise RuntimeError("onnxruntime must be installed by requirements.txt before switching to onnxruntime-gpu")

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
subprocess.check_call([
    sys.executable,
    "-c",
    "import onnxruntime as ort; providers = ort.get_available_providers(); print(ort.__version__); print(providers); assert 'CUDAExecutionProvider' in providers, providers",
])
PY
RUN if [ "$DEBUG" = 1 ] ; then \
  pip install -r requirements.dev.txt; \
  fi
RUN if [ "$MLVALIDATION" = 1 ] ; then \
  apt-get update && apt-get install default-jre -y; \
  pip install --break-system-packages -r requirements.mlval.txt; \
  fi
EXPOSE 8001

COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
