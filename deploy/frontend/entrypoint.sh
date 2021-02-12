#!/usr/bin/env bash

echo "installing frontend"
npm install

echo "serving frontend"
[ "$DEBUG" = 1 ] then:
    echo "develompent running frontend"
    npm run start
else:
    echo "production building frontend"
    npm install -g serve
    npm run build
    echo "productions running frontend"
    serve build -d -l 3000

# DANGEROUSLY_DISABLE_HOST_CHECK=true HOST=0.0.0.0 npm start