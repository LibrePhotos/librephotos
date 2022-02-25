.PHONY: default build run shell rename

include librephotos.env
DOCKER_TAG ?= ownphotos-backend
REPLACE_NAMES=sed 's/__backend_name__/$(BACKEND_CONT_NAME)/g; s/__frontend_name__/$(FRONTEND_CONT_NAME)/g; s/__proxy_name__/$(PROXY_CONT_NAME)/g; s/__redis_name__/$(REDIS_CONT_NAME)/g; s/__db_name__/$(DB_CONT_NAME)/g; s/__pgadmin_name__/$(PGADMIN_CONT_NAME)/g'

default: build

build:
	docker build -t $(DOCKER_TAG) .

run: build
	docker run $(DOCKER_TAG)

shell: build
	docker run --rm -it $(DOCKER_TAG) /bin/bash

rename:
	$(REPLACE_NAMES) docker-compose.raw > docker-compose.yml
	$(REPLACE_NAMES) docker-compose.dev.raw > docker-compose.dev.yml
	$(REPLACE_NAMES) proxy/nginx.raw > proxy/nginx.conf
