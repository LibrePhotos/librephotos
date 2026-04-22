#!/usr/bin/env bash

GIT_HASH=$(git rev-parse --short HEAD)
export GIT_HASH

echo "installing frontend"
FORCE_COLOR=true yarn install | cat
FORCE_COLOR=true yarn start | cat
