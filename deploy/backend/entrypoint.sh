#! /bin/bash
export PYTHONUNBUFFERED=TRUE
export PYTHONFAULTHANDLER=1
mkdir -p /logs
if [ -n "$SECRET_KEY" ]
then
    echo "Use env SECRET_KEY"
else 
    if [ -f /logs/secret.key ]
    then
        echo "Use existing secret.key"
        SECRET_KEY=`cat /logs/secret.key`
        export SECRET_KEY=$SECRET_KEY
    else
        echo "Create new secret.key"
        SECRET_KEY=$(python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())')
        echo $SECRET_KEY > /logs/secret.key
        export SECRET_KEY=$SECRET_KEY
    fi
fi

python image_similarity/main.py 2>&1 | tee /logs/gunicorn_image_similarity.log &
python manage.py showmigrations | tee /logs/show_migrate.log
python manage.py migrate | tee /logs/command_migrate.log
python manage.py showmigrations | tee /logs/show_migrate.log
python manage.py clear_cache 

if [ -n "$ADMIN_USERNAME" ]
then
    python manage.py createadmin -u $ADMIN_USERNAME $ADMIN_EMAIL 2>&1 | tee /logs/command_createadmin.log
fi

echo "Running backend server..."

python manage.py rqworker default 2>&1 | tee /logs/rqworker.log &

if [ "$DEBUG" = 1 ]
then
    echo "development backend starting"
    gunicorn --worker-class=gevent --reload --bind 0.0.0.0:8001 --log-level=info ownphotos.wsgi 2>&1 | tee /logs/gunicorn_django.log
else
    echo "production backend starting"
    gunicorn --worker-class=gevent --bind 0.0.0.0:8001 --log-level=info ownphotos.wsgi 2>&1 | tee /logs/gunicorn_django.log
fi
