#! /bin/bash
export PYTHONUNBUFFERED=TRUE
pip install torch==1.7.1+cpu torchvision==0.8.2+cpu faiss-cpu django-picklefield

mkdir -p /logs

python image_similarity/main.py 2>&1 | tee /logs/gunicorn_image_similarity.log &
python manage.py showmigrations | tee /logs/show_migrate.log
python manage.py migrate | tee /logs/command_migrate.log
python manage.py showmigrations | tee /logs/show_migrate.log
python manage.py build_similarity_index 2>&1 | tee /logs/command_build_similarity_index.log

python manage.py createadmin -u $ADMIN_USERNAME $ADMIN_EMAIL 2>&1 | tee /logs/command_createadmin.log

echo "Running backend server..."

python manage.py rqworker default 2>&1 | tee /logs/rqworker.log &
if [ $(ps -ef | grep -c "myApplication") -eq 1 ]; then echo "true"; fi

[ "$DEBUG" = 1 ] && RELOAD=" --reload" || RELOAD=""

gunicorn --worker-class=gevent --timeout $WORKER_TIMEOUT $RELOAD --bind backend:8001 --log-level=info ownphotos.wsgi 2>&1 | tee /logs/gunicorn_django.log 
