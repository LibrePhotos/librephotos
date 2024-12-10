FROM reallibrephotos/librephotos-base-gpu:dev

# Debug flag is more like a dev flag
ARG DEBUG
ARG MLVALIDATION
ARG IMAGE_TAG
ENV IMAGE_TAG ${IMAGE_TAG}

# Debug Python environment and dlib installation
RUN python3 --version && \
    which python3 && \
    python3 -m site && \
    python3 -c "import sys; print('Python executable:', sys.executable)" && \
    python3 -c "import dlib; print('dlib version:', dlib.__version__)" || \
    echo "dlib not found"

# Create fake dist info for dlib
RUN mkdir -p /usr/local/lib/python3.12/dist-packages/dlib-19.24.99.dist-info && \
    echo "Metadata-Version: 2.1\nName: dlib\nVersion: 19.24.99\n" > /usr/local/lib/python3.12/dist-packages/dlib-19.24.99.dist-info/METADATA && \
    echo "INSTALLER: pip\n" > /usr/local/lib/python3.12/dist-packages/dlib-19.24.99.dist-info/INSTALLER && \
    touch /usr/local/lib/python3.12/dist-packages/dlib-19.24.99.dist-info/RECORD

# Debugging: Ensure dlib is installed
RUN python -m pip show dlib || echo "dlib not found"
# Debugging: From previous image
RUN python3 -c "import dlib; print(dlib.__version__)"

WORKDIR /code
RUN git clone --depth 1 https://github.com/LibrePhotos/librephotos .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt
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
