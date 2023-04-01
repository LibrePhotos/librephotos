FROM reallibrephotos/librephotos-base:dev
# actual project
ARG DEBUG
WORKDIR /code
RUN git clone --depth 1 https://github.com/LibrePhotos/librephotos .
RUN pip install --break-system-packages --no-cache-dir -r requirements.txt
RUN if [ "$DEBUG" = 1 ] ; then \
      pip install setuptools==57.5.0; \
      pip install -r requirements.dev.txt; \
    fi
EXPOSE 8001

COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
