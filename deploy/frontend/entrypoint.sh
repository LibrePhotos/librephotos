#!/usr/bin/env bash

#echo "building frontend"
#npm run build
echo "serving frontend"
serve build -d -l 3000

# DANGEROUSLY_DISABLE_HOST_CHECK=true HOST=0.0.0.0 npm start