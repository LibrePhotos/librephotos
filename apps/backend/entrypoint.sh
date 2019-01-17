#! /bin/bash
export PYTHONUNBUFFERED=TRUE
mkdir -p /code/logs

cp /code/nginx.conf /etc/nginx/sites-enabled/default
sed -i -e 's/replaceme/'"$BACKEND_HOST"'/g' /etc/nginx/sites-enabled/default
service nginx restart

# source /venv/bin/activate

/miniconda/bin/python manage.py makemigrations api 2>&1 | tee logs/makemigrations.log
/miniconda/bin/python manage.py migrate 2>&1 | tee logs/migrate.log

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
/miniconda/bin/gunicorn --bind 0.0.0.0:8001 ownphotos.wsgi 2>&1 | tee logs/gunicorn.log
