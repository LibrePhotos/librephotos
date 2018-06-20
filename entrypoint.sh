#! /bin/bash

cp /code/nginx.conf /etc/nginx/sites-enabled/default
BACKEND_URL=${BACKEND_PROTOCOL}${BACKEND_HOST}
sed -i -e 's/replaceme/'"$BACKEND_HOST"'/g' /etc/nginx/sites-enabled/default
service nginx restart

source /venv/bin/activate

python manage.py migrate
python manage.py migrate --run-syncdb

python manage.py shell <<EOF
from django.contrib.auth.models import User
User.objects.filter(email='$ADMIN_EMAIL').delete()
User.objects.create_superuser('$ADMIN_USERNAME', '$ADMIN_EMAIL', '$ADMIN_PASSWORD')
EOF

echo "Running backend server..."

python manage.py rqworker default &
gunicorn --bind 0.0.0.0:8001 ownphotos.wsgi &



sed -i -e 's/http:\/\/changeme/'"$BACKEND_URL"'/g' /code/ownphotos-frontend/src/api_client/apiClient.js
cd /code/ownphotos-frontend
npm run build
serve -s build
