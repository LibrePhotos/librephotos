.PHONY: default build rename

include librephotos.env
REPLACE_NAMES=sed 's/__backend_name__/$(BACKEND_CONT_NAME)/g; s/__frontend_name__/$(FRONTEND_CONT_NAME)/g; s/__proxy_name__/$(PROXY_CONT_NAME)/g; s/__redis_name__/$(REDIS_CONT_NAME)/g; s/__db_name__/$(DB_CONT_NAME)/g; s/__pgadmin_name__/$(PGADMIN_CONT_NAME)/g; s/__network_name__/$(NETWORK_NAME)/g'

default: build

build: build-backend build-frontend build-proxy

build-backend:
	docker build -t reallibrephotos/librephotos:latest backend

build-frontend:
	docker build -t reallibrephotos/librephotos-frontend:latest frontend

build-proxy:
	docker build -t reallibrephotos/librephotos-proxy:latest proxy

rename:
	$(REPLACE_NAMES) docker-compose.raw > docker-compose.yml
	$(REPLACE_NAMES) docker-compose.dev.raw > docker-compose.dev.yml
	$(REPLACE_NAMES) docker-compose.e2e.raw > docker-compose.e2e.yml
