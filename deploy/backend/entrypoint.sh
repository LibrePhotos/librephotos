#! /bin/bash
export PYTHONUNBUFFERED=TRUE
export PYTHONFAULTHANDLER=1

if [[ "$(uname -m)" == "aarch64"* ]]; then
  export OPENBLAS_CORETYPE=ARMV8
  echo "ARM architecture detected. OPENBLAS_CORETYPE set to ARMV8"
fi
export OPENBLAS_NUM_THREADS=1 
export OPENBLAS_MAIN_FREE=1

mkdir -p /logs

python manage.py showmigrations | tee /logs/show_migrate.log
python manage.py migrate | tee /logs/command_migrate.log
python manage.py showmigrations | tee /logs/show_migrate.log
python manage.py collectstatic --no-input
python image_similarity/main.py 2>&1 | tee /logs/image_similarity.log &
python service/thumbnail/main.py 2>&1 | tee /logs/thumbnail.log &
python service/face_recognition/main.py 2>&1 | tee /logs/face_recognition.log &
python service/clip_embeddings/main.py 2>&1 | tee /logs/clip_embeddings.log &
python service/image_captioning/main.py 2>&1 | tee /logs/image_captioning.log &
python manage.py clear_cache 
python manage.py build_similarity_index 2>&1 | tee /logs/command_build_similarity_index.log

if [ -n "$ADMIN_USERNAME" ]
then
    python manage.py createadmin -u $ADMIN_USERNAME $ADMIN_EMAIL 2>&1 | tee /logs/command_createadmin.log
fi

echo "Running backend server..."

python manage.py qcluster 2>&1 | tee /logs/qcluster.log &

if [ "$DEBUG" = 1 ]
then
    echo "development backend starting"
    gunicorn --worker-class=gevent --reload --bind 0.0.0.0:8001 --log-level=info librephotos.wsgi 2>&1 | tee /logs/gunicorn_django.log
else
    echo "production backend starting"
    gunicorn --worker-class=gevent --bind 0.0.0.0:8001 --log-level=info librephotos.wsgi 2>&1 | tee /logs/gunicorn_django.log
fi
