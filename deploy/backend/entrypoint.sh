#! /bin/bash
export PYTHONUNBUFFERED=TRUE
export PYTHONFAULTHANDLER=1
mkdir -p /logs
python image_similarity/main.py 2>&1 | tee /logs/gunicorn_image_similarity.log &
python manage.py showmigrations | tee /logs/show_migrate.log
python manage.py migrate | tee /logs/command_migrate.log
python manage.py showmigrations | tee /logs/show_migrate.log
python manage.py clear_cache 
python manage.py createadmin -u $ADMIN_USERNAME $ADMIN_EMAIL 2>&1 | tee /logs/command_createadmin.log

echo "Running backend server..."

python manage.py rqworker default 2>&1 | tee /logs/rqworker.log &

if [ "$DEBUG" = 1 ]
then
    echo "development backend starting"
    gunicorn --worker-class=gevent --timeout 36000 --reload --bind 0.0.0.0:8001 --log-level=info ownphotos.wsgi 2>&1 | tee /logs/gunicorn_django.log
else
    echo "production backend starting"
    gunicorn --worker-class=gevent --timeout 3600 --bind 0.0.0.0:8001 --log-level=info ownphotos.wsgi 2>&1 | tee /logs/gunicorn_django.log
fi
