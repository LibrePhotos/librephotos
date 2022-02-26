FROM reallibrephotos/librephotos-dependencies:dev
# actual project
ARG DEBUG
WORKDIR /code
RUN git clone https://github.com/LibrePhotos/librephotos .
RUN pip install -r requirements.txt
RUN if [ "$DEBUG" = 1 ] ; then pip install -r requirements.dev.txt ;  fi
EXPOSE 8001

COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
