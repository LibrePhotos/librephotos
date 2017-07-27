.PHONY: default build run shell

DOCKER_TAG ?= ownphotos-frontend

default: build

build:
	docker build -t $(DOCKER_TAG) .

run: build
	docker run $(DOCKER_TAG)

shell: build
	docker run --rm -it $(DOCKER_TAG) /bin/bash
