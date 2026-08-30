import datetime
import os

from librephotos.logging_bootstrap import (
    build_logging_config,
    ensure_logs_root,
    resolve_to_console,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_LOGS = os.environ.get("BASE_LOGS", "/logs/")
BASE_DATA = os.environ.get("BASE_DATA", "/")
PHOTOS = os.environ.get("PHOTOS", os.path.join(BASE_DATA, "data"))
STATIC_URL = "api/static/"
MEDIA_URL = "/media/"
MEDIA_ROOT = os.path.join(BASE_DATA, "protected_media")
STATIC_ROOT = os.path.join(BASE_DIR, "static")
DATA_ROOT = PHOTOS

# Serving an original file is nginx's job: the backend authorizes the request
# and hands off with X-Accel-Redirect. nginx's workers run as uid/gid 101 in the
# stock proxy image ("user nginx;" in its nginx.conf) while the backend runs as
# root, so the two disagree about which files are readable and a library the
# scanner indexed fine can still 403 on playback. The media diagnostics use
# these to explain such a failure instead of guessing at it; override them only
# if you run a rebuilt proxy whose nginx uses different ids.
WEBSERVER_UID = int(os.environ.get("WEBSERVER_UID", "101"))
WEBSERVER_GID = int(os.environ.get("WEBSERVER_GID", "101"))
IM2TXT_ROOT = os.path.join(MEDIA_ROOT, "data_models", "im2txt")

BLIP_ROOT = os.path.join(MEDIA_ROOT, "data_models", "blip")
PLACES365_ROOT = os.path.join(MEDIA_ROOT, "data_models", "places365", "model")
CLIP_ROOT = os.path.join(MEDIA_ROOT, "data_models", "clip-embeddings")

# Videos in a container or codec the browser cannot decode are converted on the
# fly for users who turn on "Always transcode videos". A live conversion has no
# known length, so it cannot be sought at all; the same conversion is therefore
# written to a file in the background and later plays are served from that,
# seekable. See api/transcode_cache.py.
#
# The cache is bounded twice over: it never grows past TRANSCODE_CACHE_MAX_GB,
# and it never eats into the last TRANSCODE_CACHE_MIN_FREE_GB of the volume,
# which is shared with the thumbnails and (in the default layout) the database.
# Set the size to 0 to switch caching off and keep only the live streaming.
TRANSCODE_CACHE_ROOT = os.path.join(MEDIA_ROOT, "transcoded")
TRANSCODE_CACHE_MAX_GB = float(os.environ.get("TRANSCODE_CACHE_MAX_GB", "10"))
TRANSCODE_CACHE_MIN_FREE_GB = float(os.environ.get("TRANSCODE_CACHE_MIN_FREE_GB", "2"))
TRANSCODE_CACHE_MAX_CONCURRENT = int(
    os.environ.get("TRANSCODE_CACHE_MAX_CONCURRENT", "1")
)
# How far the background conversion stands back from everything else. It is
# niced and given half the cores, because playback, thumbnails and the scan all
# matter more than a copy nobody is waiting for.
TRANSCODE_CACHE_NICE = int(os.environ.get("TRANSCODE_CACHE_NICE", "10"))
LOGS_ROOT = BASE_LOGS
# Create the directory before anything in this module writes to it. secret.key
# lives in there too and is written some 40 lines further down, so an install
# without a /logs volume used to die on that open() with a FileNotFoundError
# that never mentioned logs. Fail here instead, naming the path.
ensure_logs_root(LOGS_ROOT)
DEMO_SITE = os.environ.get("DEMO_SITE", "False") != "False"

# Matplotlib comes along with insightface, which the face recognition service
# imports. Left to itself it keeps its font cache under $HOME, and when the home
# directory is not writable - it resolves to `/` in plenty of container setups -
# it falls back to a fresh /tmp/matplotlib-XXXXXXXX directory and rebuilds the
# font cache on *every* process start. Give it a directory we own instead. The
# ML services are spawned with subprocess.Popen (see api/services.py), so they
# inherit this.
MPLCONFIGDIR = os.environ.get("MPLCONFIGDIR") or os.path.join(MEDIA_ROOT, "matplotlib")
try:
    os.makedirs(MPLCONFIGDIR, exist_ok=True)
except OSError as e:
    print(f"could not create matplotlib cache directory {MPLCONFIGDIR}: {e}")
os.environ["MPLCONFIGDIR"] = MPLCONFIGDIR

WSGI_APPLICATION = "librephotos.wsgi.application"
AUTH_USER_MODEL = "api.User"
ROOT_URLCONF = "librephotos.urls"
DEFAULT_AUTO_FIELD = "django.db.models.AutoField"
DEBUG = False

SECRET_KEY_FILENAME = os.path.join(BASE_LOGS, "secret.key")
SECRET_KEY = ""


def _env_flag(name, default=True):
    """Read an on/off switch from the environment (true/1/yes/on, any case)."""
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("true", "1", "yes", "on")


# analyze files to detect embedded media (e.g. in motion photos)
FEATURE_PROCESS_EMBEDDED_MEDIA = _env_flag("FEATURE_PROCESS_EMBEDDED_MEDIA")

# Deploy-time feature switches. They all default to on, so an upgrade changes
# nothing; set one to false/0/no/off to stop that work from being done at all.
FEATURE_VIDEO = _env_flag("FEATURE_VIDEO")
FEATURE_FACE_DETECTION = _env_flag("FEATURE_FACE_DETECTION")
FEATURE_FACE_CLUSTER = _env_flag("FEATURE_FACE_CLUSTER")
FEATURE_IMAGE_CAPTIONING = _env_flag("FEATURE_IMAGE_CAPTIONING")
FEATURE_REVERSE_GEOCODING = _env_flag("FEATURE_REVERSE_GEOCODING")
FEATURE_SCENE_CLASSIFICATION = _env_flag("FEATURE_SCENE_CLASSIFICATION")

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
    # django.contrib.sites is required by allauth (SocialApp is tied to a Site).
    "django.contrib.sites",
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
    # OIDC / SSO via django-allauth. The generic openid_connect provider handles
    # any standards-compliant IdP (Keycloak, Authentik, Authelia, Zitadel, Google,
    # Azure, ...). Provider credentials live in the DB (admin-editable SocialApp),
    # not the environment. See api/adapters.py for the login/linking policy and
    # api/views/sso.py for the JWT bridge.
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.openid_connect",
]

SITE_ID = 1

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

# Number of background workers doing the heavy lifting (thumbnails, face
# detection, captioning). Left unset, django-q falls back to cpu_count(), which
# reports the *host's* cores even when the container is capped with a compose
# `cpus:` limit - so the pool stays just as wide and the limit only starves it.
# Setting this is the way to actually reduce LibrePhotos' CPU and RAM appetite.
if os.environ.get("WORKER_CONCURRENCY"):
    Q_CLUSTER["workers"] = int(os.environ["WORKER_CONCURRENCY"])

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
                ("tomtom", "TomTom"),
            ),
        },
    ],
    "map_tile_provider": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                ("photoprism", "PhotoPrism (default)"),
                ("osm", "OpenStreetMap"),
                ("none", "None (disable map display)"),
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
                ("blip_base_capfilt_large", "BLIP Model"),
                ("moondream", "Moondream Visual LLM"),
            ),
        },
    ],
    "llm_model": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                ("none", "None"),
                ("mistral-7b-instruct-v0.2.Q5_K_M", "Mistral 7B Instruct v0.2 Q5 K M"),
                ("moondream", "Moondream Visual LLM"),
            ),
        },
    ],
    "tagging_model": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                ("places365", "Places365 Scene Recognition"),
                ("siglip2", "SigLIP 2 (Real-world photo tags)"),
            ),
        },
    ],
    "ocr_model": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                # Lowercase "none" mirrors the llm_model sibling; the "None"
                # default in CONSTANCE_CONFIG still reads as unselected because
                # _is_model_not_selected() lowercases before comparing.
                ("none", "None"),
                ("ppocrv6_tiny", "PP-OCRv6 Tiny (fastest, smallest)"),
                ("ppocrv6_small", "PP-OCRv6 Small (balanced)"),
                ("ppocrv6_medium", "PP-OCRv6 Medium (most accurate)"),
            ),
        },
    ],
    "face_recognition_model": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            # The InsightFace model packs carried by api.ml_models.ML_MODELS
            # under MlTypes.FACE_RECOGNITION, labelled as the frontend's
            # selector labels them (SiteSettings.tsx). There is no "none" entry:
            # face recognition cannot be turned off from here.
            "choices": (
                ("buffalo_sc", "buffalo_sc (lightweight, default)"),
                ("buffalo_s", "buffalo_s"),
                ("buffalo_m", "buffalo_m"),
                ("buffalo_l", "buffalo_l (most accurate)"),
                ("antelopev2", "antelopev2"),
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
    "NEXTCLOUD_ENABLED": (
        os.environ.get("NEXTCLOUD_ENABLED", "").strip().lower()
        in ("true", "1", "t", "yes", "on"),
        "Enable the Nextcloud integration",
        bool,
    ),
    "SKIP_PATTERNS": (
        os.environ.get("SKIP_PATTERNS", ""),
        "Comma delimited list of patterns to ignore (e.g. '@eaDir,#recycle' for synology devices)",
        str,
    ),
    "MAP_API_PROVIDER": (
        os.environ.get("MAP_API_PROVIDER", "nominatim"),
        "Map Provider",
        "map_api_provider",
    ),
    "MAP_API_KEY": (os.environ.get("MAPBOX_API_KEY", ""), "Map Box API Key", str),
    "MAP_TILE_PROVIDER": (
        os.environ.get("MAP_TILE_PROVIDER", "photoprism"),
        "Map tile provider (map background shown behind photo pins)",
        "map_tile_provider",
    ),
    "IMAGE_DIRS": ("/data", "Image dirs list (serialized json)", str),
    "CAPTIONING_MODEL": ("im2txt", "Captioning model", "captioning_model"),
    "LLM_MODEL": ("None", "Large Language Model", "llm_model"),
    "TAGGING_MODEL": ("places365", "Tagging model", "tagging_model"),
    "OCR_MODEL": (
        "None",
        "OCR model. OCR extracts ALL readable text from photos into the database"
        " as plaintext (including documents, receipts, IDs) — leave None if you do"
        " not want that.",
        "ocr_model",
    ),
    "FACE_RECOGNITION_MODEL": (
        "buffalo_sc",
        "Face recognition model",
        "face_recognition_model",
    ),
    "LOG_MAX_BYTES": (
        200 * 1024 * 1024,
        "Maximum log file size in bytes before rotation (default 200 MB)",
        int,
    ),
    "LOG_BACKUP_COUNT": (
        10,
        "Number of rotated log files to keep (default 10)",
        int,
    ),
    "OIDC_ENABLED": (
        False,
        "Show a single-sign-on (SSO) button on the login screen. Requires a "
        "configured OpenID Connect provider (Admin → Social Applications) and, "
        "for provisioning new users, a configured email provider (Site Settings "
        "→ Email) so the identity provider's email can be trusted.",
        bool,
    ),
    "OIDC_BUTTON_LABEL": (
        "Sign in with SSO",
        "Text shown on the single-sign-on button on the login screen",
        str,
    ),
    "OIDC_ALLOW_SIGNUP": (
        False,
        "Allow a first-time SSO login to create a new LibrePhotos account. When "
        "off, SSO only logs in users that already exist (admin-provisioned). "
        "Auto-creation additionally requires a configured email provider so the "
        "identity provider's verified-email claim can be trusted.",
        bool,
    ),
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
# The media endpoints mark their own 403s so the frontend can tell "your
# session expired" apart from "the web server cannot read this file"; a
# split-origin dev setup can only read that header if it is exposed.
CORS_EXPOSE_HEADERS = ("x-media-error",)
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
    "DEFAULT_THROTTLE_RATES": {
        "password_reset": os.environ.get("PASSWORD_RESET_THROTTLE_RATE", "5/hour"),
    },
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
    # Required by allauth (>=0.56): rebuilds request state for the account flow.
    "allauth.account.middleware.AccountMiddleware",
]

# allauth adds its authentication backend alongside the default ModelBackend so
# that regular username/password login keeps working (hybrid login — the
# maintainer's call on #401). ModelBackend stays first so password auth is
# unaffected.
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
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
        # Using persistent connections instead of pooling due to Django 5.2 pooling bugs
        # (type conversion issues with COUNT queries - see error with UUID returned as string)
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

# Password Hashers - Argon2 is faster and more secure than PBKDF2
# Existing passwords will continue to work (PBKDF2 fallback)
# New passwords and password changes will use Argon2
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
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

# The whole log configuration lives in librephotos/logging_bootstrap.py so the
# non-Django processes can share it. LOG_LEVEL and LOG_TO_CONSOLE are read from
# the environment rather than from constance: the qcluster workers and the ML
# services need the same answer and several of them never touch the database.
# Rotation size and backup count start at the defaults here and are refined from
# constance once the database is up (see api.util.reconfigure_logging).
LOGGING = build_logging_config(
    logs_root=LOGS_ROOT,
    level=os.environ.get("LOG_LEVEL"),
    to_console=resolve_to_console(),
)

CHUNKED_UPLOAD_PATH = ""
CHUNKED_UPLOAD_TO = os.path.join("chunked_uploads")

DEFAULT_FAVORITE_MIN_RATING = os.environ.get("DEFAULT_FAVORITE_MIN_RATING", 4)
IMAGE_SIMILARITY_SERVER = "http://localhost:8002"

# Email / SMTP configuration.
#
# Outgoing mail is configured at runtime from the database (the admin Site
# Settings UI), not the environment. `DynamicEmailBackend` reads the stored
# `EmailConfig` at send time and delegates to Django's SMTP backend; when email
# is unconfigured it is a safe no-op (or the console backend under DEBUG, so
# reset links still appear in dev logs). This keeps the SMTP credential
# encrypted at rest and editable without a redeploy. See api/mail.py.
EMAIL_BACKEND = "api.mail.DynamicEmailBackend"
# Fallback from-address when the admin has not set one; the stored config value
# takes precedence (see EmailConfig.effective_from_email).
DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL", "LibrePhotos <no-reply@localhost>"
)

# Base URL of the frontend, used to build the link in the password-reset email.
# Falls back to the request's own origin when not set (see PasswordResetView).
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "")

# ---------------------------------------------------------------------------
# django-allauth (OIDC / SSO) — see api/adapters.py and api/views/sso.py
# ---------------------------------------------------------------------------
# LibrePhotos authenticates with JWT, not sessions. allauth runs the OIDC
# redirect/callback dance server-side (establishing a short-lived Django
# session); LOGIN_REDIRECT_URL then hands off to the JWT bridge, which mints the
# same simplejwt access/refresh the password login issues, sets the cookies
# identically, and redirects into the SPA — so nothing downstream can tell an
# SSO login from a password login.
LOGIN_REDIRECT_URL = "/api/auth/sso/finish/"

# All login/linking/provisioning policy lives in the adapter (stable API across
# allauth versions, and able to read runtime state such as EmailConfig and the
# OIDC_* Constance flags). Keep the declarative settings minimal.
SOCIALACCOUNT_ADAPTER = "api.adapters.SSOSocialAccountAdapter"
ACCOUNT_ADAPTER = "api.adapters.NoLocalSignupAccountAdapter"

# We never drive password signup/login or verification emails through allauth —
# LibrePhotos keeps its own login and (separately) its own password reset. Trust
# the IdP's verified-email claim; the adapter enforces it explicitly.
ACCOUNT_EMAIL_VERIFICATION = "none"
SOCIALACCOUNT_EMAIL_VERIFICATION = "none"

# The SPA button click is the deliberate user action, so redirect straight to the
# IdP on GET rather than rendering allauth's HTML interstitial (we ship no
# allauth templates).
SOCIALACCOUNT_LOGIN_ON_GET = True

# We only need the identity to mint our own JWT; don't persist the IdP's tokens.
SOCIALACCOUNT_STORE_TOKENS = False

# Keep allauth to brokering OIDC and nothing else. Without this, including
# allauth.urls also mounts allauth's own session-based account views: a second
# login form, a signup form, and — worst — a second password-reset flow that
# would bypass the throttling and address-enumeration protections on
# LibrePhotos' own reset endpoint. This drops those routes (signup, password
# reset/change/set, email management) while leaving account_login/logout
# resolvable, so allauth's internal reverse() calls still work, and it refuses
# non-GET requests to the login view it does keep.
#
# Note this disables *allauth's* local authentication, not LibrePhotos': the
# username/password login is our own simplejwt endpoint and is untouched, so
# hybrid login still works as the maintainer asked.
SOCIALACCOUNT_ONLY = True
