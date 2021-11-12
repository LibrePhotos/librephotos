#!/usr/bin/env bash

echo "installing frontend"
npm install --legacy-peer-deps
npm run start

# DANGEROUSLY_DISABLE_HOST_CHECK=true HOST=0.0.0.0 npm start
