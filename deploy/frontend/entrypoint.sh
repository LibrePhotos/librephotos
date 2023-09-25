#!/usr/bin/env bash

echo "installing frontend"
FORCE_COLOR=true npm install --legacy-peer-deps | cat
FORCE_COLOR=true npm postinstall | cat
FORCE_COLOR=true npm start | cat
# DANGEROUSLY_DISABLE_HOST_CHECK=true HOST=0.0.0.0 npm start
