FROM reallibrephotos/librephotos-dependencies:dev

# install rust
RUN apt install -y rustc
# actual project
ARG DEBUG
WORKDIR /code
RUN git clone https://github.com/LibrePhotos/librephotos .
RUN pip install -r requirements.txt
RUN if [ "$DEBUG" = 1 ] ; then pip install -r requirements.dev.txt ;  fi
RUN python -m spacy download en_core_web_sm
EXPOSE 8001

COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
