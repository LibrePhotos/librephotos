#! /bin/bash
export PYTHONUNBUFFERED=TRUE
mkdir -p /code/logs

cp /code/nginx.conf /etc/nginx/sites-enabled/default
sed -i -e 's/replaceme/'"$BACKEND_HOST"'/g' /etc/nginx/sites-enabled/default

# run nginx as root - see https://github.com/hooram/ownphotos/issues/78
sed -i -e 's/user www-data/user root/g' /etc/nginx/nginx.conf

service nginx restart

/miniconda/bin/python image_similarity/main.py 2>&1 | tee logs/gunicorn_image_similarity.log &
/miniconda/bin/python manage.py showmigrations | tee logs/show_migrate.log
/miniconda/bin/python manage.py migrate | tee logs/command_migrate.log
/miniconda/bin/python manage.py showmigrations | tee logs/show_migrate.log
/miniconda/bin/python manage.py build_similarity_index 2>&1 | tee logs/command_build_similarity_index.log

/miniconda/bin/python manage.py shell <<EOF
from api.models import User

if User.objects.filter(username="$ADMIN_USERNAME").exists():
    admin_user = User.objects.get(username="$ADMIN_USERNAME")
    admin_user.set_password("$ADMIN_PASSWORD")
    admin_user.save()
else:
    User.objects.create_superuser('$ADMIN_USERNAME', '$ADMIN_EMAIL', '$ADMIN_PASSWORD')
EOF

echo "Running backend server..."

/miniconda/bin/python manage.py rqworker default 2>&1 | tee logs/rqworker.log &
/miniconda/bin/gunicorn --worker-class=gevent --timeout 120 --bind 0.0.0.0:8001 --log-level=info ownphotos.wsgi 2>&1 | tee logs/gunicorn_django.log
