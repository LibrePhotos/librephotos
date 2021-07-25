#!/usr/bin/env bash

echo "installing frontend"
npm install --legacy-peer-deps

echo "serving frontend"
if [ "$DEBUG" = 1 ]
then
    echo "develompent running frontend"
    npm run start
else
    echo "productions running frontend"
    serve build -d -l 3000
fi
# DANGEROUSLY_DISABLE_HOST_CHECK=true HOST=0.0.0.0 npm start
