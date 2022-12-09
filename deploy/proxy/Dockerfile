FROM nginx
ENV BACKEND_NAME=${BACKEND_NAME:-backend}
ENV FRONTEND_NAME=${FRONTEND_NAME:-frontend}
ENV VAR_PREFIX='$'
COPY nginx.tpl /etc/nginx/nginx.tpl
ENTRYPOINT envsubst < /etc/nginx/nginx.tpl > /etc/nginx/nginx.conf; nginx -g 'daemon off;'