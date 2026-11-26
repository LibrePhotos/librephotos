# Stable branch; a bare "nginx" floats with mainline and a new major.
FROM nginx:1.30-alpine-slim
RUN apk upgrade --no-cache
COPY deploy/docker/proxy/nginx.conf /etc/nginx/nginx.conf
