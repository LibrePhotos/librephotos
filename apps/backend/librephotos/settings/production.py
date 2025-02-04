import datetime
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_LOGS = os.environ.get("BASE_LOGS", "/logs/")
BASE_DATA = os.environ.get("BASE_DATA", "/")
PHOTOS = os.environ.get("PHOTOS", os.path.join(BASE_DATA, "data"))
STATIC_URL = "api/static/"
MEDIA_URL = "/media/"
MEDIA_ROOT = os.path.join(BASE_DATA, "protected_media")
STATIC_ROOT = os.path.join(BASE_DIR, "static")
DATA_ROOT = PHOTOS
IM2TXT_ROOT = os.path.join(MEDIA_ROOT, "data_models", "im2txt")
IM2TXT_ONNX_ROOT = os.path.join(MEDIA_ROOT, "data_models", "im2txt_onnx")
BLIP_ROOT = os.path.join(MEDIA_ROOT, "data_models", "blip")
PLACES365_ROOT = os.path.join(MEDIA_ROOT, "data_models", "places365", "model")
CLIP_ROOT = os.path.join(MEDIA_ROOT, "data_models", "clip-embeddings")
LOGS_ROOT = BASE_LOGS

WSGI_APPLICATION = "librephotos.wsgi.application"
AUTH_USER_MODEL = "api.User"
ROOT_URLCONF = "librephotos.urls"
DEFAULT_AUTO_FIELD = "django.db.models.AutoField"
DEBUG = False

SECRET_KEY_FILENAME = os.path.join(BASE_LOGS, "secret.key")
SECRET_KEY = ""

if os.environ.get("SECRET_KEY"):
    SECRET_KEY = os.environ["SECRET_KEY"]
    print("use SECRET_KEY from env")

if not SECRET_KEY and os.path.exists(SECRET_KEY_FILENAME):
    with open(SECRET_KEY_FILENAME) as f:
        SECRET_KEY = f.read().strip()
        print("use SECRET_KEY from file")

if not SECRET_KEY:
    from django.core.management.utils import get_random_secret_key

    with open(SECRET_KEY_FILENAME, "w") as f:
        f.write(get_random_secret_key())
        print("generate SECRET_KEY and save to file")
    with open(SECRET_KEY_FILENAME) as f:
        SECRET_KEY = f.read().strip()
        print("use SECRET_KEY from file")

ALLOWED_HOSTS = ["localhost", os.environ.get("BACKEND_HOST", "backend")]

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": datetime.timedelta(minutes=5),
    "REFRESH_TOKEN_LIFETIME": datetime.timedelta(
        days=int(os.environ.get("REFRESH_TOKEN_DAYS", "7"))
    ),
}

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "api",
    "nextcloud",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "chunked_upload",
    "django_extensions",
    "constance",
    "constance.backends.database",
    "django_q",
]

Q_CLUSTER = {
    "name": "DjangORM",
    "queue_limit": 50,
    "recycle": 50,
    "timeout": 10000000,
    "retry": 20000000,
    "orm": "default",
    "max_rss": 300000,
    "poll": 1,
}

CONSTANCE_BACKEND = "constance.backends.database.DatabaseBackend"
CONSTANCE_ADDITIONAL_FIELDS = {
    "map_api_provider": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                ("mapbox", "Mapbox"),
                ("maptiler", "MapTiler"),
                ("nominatim", "Nominatim (OpenStreetMap)"),
                ("opencage", "OpenCage"),
                ("photon", "Photon"),
                ("tomtom", "TomTom"),
            ),
        },
    ],
    "captioning_model": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                ("none", "None"),
                ("im2txt", "im2txt PyTorch Model"),
                ("im2txt_onnx", "im2txt ONNX Model"),
                ("blip_base_capfilt_large", "BLIP Model"),
            ),
        },
    ],
    "llm_model": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                ("none", "None"),
                ("mistral-7b-v0.1.Q5_K_M", "Mistral 7B v0.1 Q5 K M"),
                ("mistral-7b-instruct-v0.2.Q5_K_M", "Mistral 7B Instruct v0.2 Q5 K M"),
            ),
        },
    ],
}
CONSTANCE_CONFIG = {
    "ALLOW_REGISTRATION": (False, "Publicly allow user registration", bool),
    "ALLOW_UPLOAD": (
        os.environ.get("ALLOW_UPLOAD", "True") not in ("false", "False", "0", "f"),
        "Allow uploading files",
        bool,
    ),
    "SKIP_PATTERNS": (
        os.environ.get("SKIP_PATTERNS", ""),
        "Comma delimited list of patterns to ignore (e.g. '@eaDir,#recycle' for synology devices)",
        str,
    ),
    "MAP_API_PROVIDER": (
        os.environ.get("MAP_API_PROVIDER", "photon"),
        "Map Provider",
        "map_api_provider",
    ),
    "MAP_API_KEY": (os.environ.get("MAPBOX_API_KEY", ""), "Map Box API Key", str),
    "IMAGE_DIRS": ("/data", "Image dirs list (serialized json)", str),
    "CAPTIONING_MODEL": ("im2txt", "Captioning model", "captioning_model"),
    "LLM_MODEL": ("None", "Large Language Model", "llm_model"),
}

INTERNAL_IPS = ("127.0.0.1", "localhost")

CORS_ALLOW_HEADERS = (
    "cache-control",
    "accept",
    "accept-encoding",
    "allow-credentials",
    "withcredentials",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
)
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = ["http://localhost:3000"]

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.BasicAuthentication",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": ("django_filters.rest_framework.DjangoFilterBackend",),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "EXCEPTION_HANDLER": "api.views.views.custom_exception_handler",
    "PAGE_SIZE": 20000,
}
REST_FRAMEWORK_EXTENSIONS = {
    "DEFAULT_OBJECT_CACHE_KEY_FUNC": "rest_framework_extensions.utils.default_object_cache_key_func",
    "DEFAULT_LIST_CACHE_KEY_FUNC": "rest_framework_extensions.utils.default_list_cache_key_func",
}

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "api.middleware.FingerPrintMiddleware",
]

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "db"),
        "USER": os.environ.get("DB_USER", "docker"),
        "PASSWORD": os.environ.get("DB_PASS", "AaAa1234"),
        "HOST": os.environ.get("DB_HOST", "db"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "CONN_MAX_AGE": 600,
        "CONN_HEALTH_CHECKS": True,
    },
}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_L10N = True
USE_TZ = True

CSRF_TRUSTED_ORIGINS = [
    "http://localhost:3000",
]
if os.environ.get("CSRF_TRUSTED_ORIGINS"):
    CSRF_TRUSTED_ORIGINS.append(os.environ.get("CSRF_TRUSTED_ORIGINS"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
        },
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "INFO",
        },
    },
}

CHUNKED_UPLOAD_PATH = ""
CHUNKED_UPLOAD_TO = os.path.join("chunked_uploads")

DEFAULT_FAVORITE_MIN_RATING = os.environ.get("DEFAULT_FAVORITE_MIN_RATING", 4)
IMAGE_SIMILARITY_SERVER = "http://localhost:8002"
