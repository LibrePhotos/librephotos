#! /bin/bash

source /venv/bin/activate

python manage.py migrate
python manage.py migrate --run-syncdb

python manage.py shell <<EOF
from django.contrib.auth.models import User
User.objects.filter(email='$ADMIN_EMAIL').delete()
User.objects.create_superuser('$ADMIN_EMAIL', '$ADMIN_USERNAME', '$ADMIN_PASSWORD')
EOF

python manage.py runserver
