#! /bin/bash

source /venv/bin/activate

python manage.py migrate
python manage.py migrate --run-syncdb

python manage.py shell <<EOF
from django.contrib.auth.models import User
User.objects.filter(email='$ADMIN_EMAIL').delete()
User.objects.create_superuser('$ADMIN_USERNAME', '$ADMIN_EMAIL', '$ADMIN_PASSWORD')
EOF

echo "Running server..."

python manage.py runserver 0.0.0.0:8000
