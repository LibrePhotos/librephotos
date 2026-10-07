"""Django settings for the reference server and the fixture build on SQLite.

lp_twin_settings (production settings, any host name, LP_DJANGO_DIRECT,
LP_DJANGO_MOCK) with the database Django's SQLite mode ships in
librephotos/settings/production_noproxy.py (DB_BACKEND=sqlite): the same
engine, IMMEDIATE transactions, 5 s busy timeout and pragmas, with the file at
LP_SQLITE_PATH instead of $BASE_DATA/db/librephotos.sqlite3.
"""

import os

from lp_twin_settings import *  # noqa: F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ["LP_SQLITE_PATH"],
        "OPTIONS": {
            "transaction_mode": "IMMEDIATE",
            "timeout": 5,  # seconds
            "init_command": """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=NORMAL;
                PRAGMA mmap_size=134217728;
                PRAGMA journal_size_limit=27103364;
                PRAGMA cache_size=2000;
            """,
        },
    },
}
# django.contrib.postgres registers PostgreSQL-only lookups and operations, so
# it leaves the app list when the database is not PostgreSQL (as in
# production_noproxy.py).
INSTALLED_APPS = [app for app in INSTALLED_APPS if app != "django.contrib.postgres"]  # noqa: F405
