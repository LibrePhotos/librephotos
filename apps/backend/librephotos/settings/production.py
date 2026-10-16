import datetime
import logging
import os

from librephotos.env import (
    env_flag,
    env_float,
    env_int,
    env_list,
    env_str,
    export,
    protected_media_root,
)
from librephotos.logging_bootstrap import (
    build_logging_config,
    defer,
    ensure_logs_root,
    rename_legacy_log_file,
    resolve_to_console,
)
from librephotos.secret_key import load_or_create_secret_key

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_LOGS = env_str("BASE_LOGS", "/logs/")
BASE_DATA = env_str("BASE_DATA", "/")
PHOTOS = env_str("PHOTOS", os.path.join(BASE_DATA, "data"))
STATIC_URL = "api/static/"
MEDIA_URL = "/media/"
MEDIA_ROOT = protected_media_root(BASE_DATA)
STATIC_ROOT = os.path.join(BASE_DIR, "static")
DATA_ROOT = PHOTOS

# Serving an original file is nginx's job: the backend authorizes the request
# and hands off with X-Accel-Redirect. nginx's workers run as uid/gid 101 in the
# stock proxy image ("user nginx;" in its nginx.conf) while the backend runs as
# root, so the two disagree about which files are readable and a library the
# scanner indexed fine can still 403 on playback. The media diagnostics use
# these to explain such a failure instead of guessing at it; override them only
# if you run a rebuilt proxy whose nginx uses different ids.
WEBSERVER_UID = env_int("WEBSERVER_UID", 101)
WEBSERVER_GID = env_int("WEBSERVER_GID", 101)

# Videos in a container or codec the browser cannot decode are converted on the
# fly, and every video is converted for users who turn on "Always transcode
# videos". A live conversion has no known length, so it cannot be sought at all;
# the same conversion is therefore written to a file in the background and later
# plays are served from that, seekable. See api/video/transcode_cache.py.
#
# The cache is bounded twice over: it never grows past TRANSCODE_CACHE_MAX_GB,
# and it never eats into the last TRANSCODE_CACHE_MIN_FREE_GB of the volume,
# which is shared with the thumbnails and (in the default layout) the database.
# Set the size to 0 to switch caching off and keep only the live streaming.
TRANSCODE_CACHE_ROOT = os.path.join(MEDIA_ROOT, "transcoded")
TRANSCODE_CACHE_MAX_GB = env_float("TRANSCODE_CACHE_MAX_GB", 10)
TRANSCODE_CACHE_MIN_FREE_GB = env_float("TRANSCODE_CACHE_MIN_FREE_GB", 2)
TRANSCODE_CACHE_MAX_CONCURRENT = env_int("TRANSCODE_CACHE_MAX_CONCURRENT", 1)
# How far the background conversion stands back from everything else. It is
# niced and given half the cores, because playback, thumbnails and the scan all
# matter more than a copy nobody is waiting for.
TRANSCODE_CACHE_NICE = env_int("TRANSCODE_CACHE_NICE", 10)

# What the *live* conversion -- the one a viewer is waiting on -- is allowed to
# take. Left alone ffmpeg uses every core and converts as fast as the hardware
# permits, so one person opening one video can starve the web UI, the scan
# workers and everybody else. Playback needs output a little faster than real
# time and nothing more.
#
# Cores are capped to 1/N of the machine, and the conversion is held to
# TRANSCODE_LIVE_READRATE times real time after an initial burst of
# TRANSCODE_LIVE_BURST_SECONDS, which keeps the start instant and gives the
# browser a buffer. Set the readrate to 0 to convert as fast as the host can.
TRANSCODE_LIVE_CPU_FRACTION = max(1, env_int("TRANSCODE_LIVE_CPU_FRACTION", 2))
TRANSCODE_LIVE_READRATE = env_float("TRANSCODE_LIVE_READRATE", 2)
TRANSCODE_LIVE_BURST_SECONDS = env_float("TRANSCODE_LIVE_BURST_SECONDS", 30)
LOGS_ROOT = BASE_LOGS
# Create the directory before the logging configuration below opens a file in
# it, so an install without a /logs volume fails here, naming the path, rather
# than with a FileNotFoundError that never mentions logs.
ensure_logs_root(LOGS_ROOT)
# Releases up to 1.3.0 wrote ownphotos.log; move it (and its rotated backups)
# to the new name before the handler below creates an empty one.
rename_legacy_log_file(LOGS_ROOT)

# Matplotlib comes along with insightface, which the face recognition service
# imports. Left to itself it keeps its font cache under $HOME, and when the home
# directory is not writable - it resolves to `/` in plenty of container setups -
# it falls back to a fresh /tmp/matplotlib-XXXXXXXX directory and rebuilds the
# font cache on *every* process start. Give it a directory we own instead. The
# ML services are spawned with subprocess.Popen (see api/runtime/supervisor.py), so they
# inherit this.
MPLCONFIGDIR = env_str("MPLCONFIGDIR") or os.path.join(MEDIA_ROOT, "matplotlib")
try:
    os.makedirs(MPLCONFIGDIR, exist_ok=True)
except OSError as e:
    defer(
        logging.WARNING,
        f"could not create matplotlib cache directory {MPLCONFIGDIR}: {e}",
    )
export("MPLCONFIGDIR", MPLCONFIGDIR)

WSGI_APPLICATION = "librephotos.wsgi.application"
AUTH_USER_MODEL = "api.User"
ROOT_URLCONF = "librephotos.urls"
DEFAULT_AUTO_FIELD = "django.db.models.AutoField"
DEBUG = False

# Without SECRET_KEY in the environment the key is generated once and kept on
# the protected_media volume, which survives container recreation everywhere.
# 1.3.0 and older kept it in BASE_LOGS, which people zip for bug reports; an
# old file there is moved on start (librephotos/secret_key.py, #2381).
SECRET_KEY_FILENAME = os.path.join(MEDIA_ROOT, "secret.key")
LEGACY_SECRET_KEY_FILENAME = os.path.join(BASE_LOGS, "secret.key")
SECRET_KEY = env_str("SECRET_KEY")
if SECRET_KEY:
    defer(logging.DEBUG, "use SECRET_KEY from env")
else:
    SECRET_KEY = load_or_create_secret_key(
        SECRET_KEY_FILENAME, legacy_path=LEGACY_SECRET_KEY_FILENAME
    )
    defer(logging.DEBUG, "use SECRET_KEY from file")


# The thumbnail settings apply to what is rendered from now on: newly scanned
# photos, a rotation, a file whose content changed. Existing thumbnails keep
# the size and quality they were rendered with. Out-of-range values are
# clamped to the nearest limit.
#
# WebP quality (1-100) of the 500 and 250 px square thumbnails the photo grids
# show.
SQUARE_THUMBNAIL_QUALITY = min(100, max(1, env_int("SQUARE_THUMBNAIL_QUALITY", 80)))
# WebP quality (1-100) and height in pixels (500-4320) of the big thumbnail the
# lightbox shows and duplicate detection and the ML models read. Never lower
# than the 500 px square, which is resized from it.
BIG_THUMBNAIL_QUALITY = min(100, max(1, env_int("BIG_THUMBNAIL_QUALITY", 95)))
BIG_THUMBNAIL_HEIGHT = min(4320, max(500, env_int("BIG_THUMBNAIL_HEIGHT", 1080)))
# The animated previews of videos in the grids: the first 1-30 seconds,
# encoded with this x264 CRF (0-51; lower looks better and takes more space).
VIDEO_PREVIEW_SECONDS = min(30, max(1, env_int("VIDEO_PREVIEW_SECONDS", 5)))
VIDEO_PREVIEW_CRF = min(51, max(0, env_int("VIDEO_PREVIEW_CRF", 20)))


# Demo mode ignores password changes (see api/serializers/user.py), so it is
# strictly opt-in: DEMO_SITE=false, 0 or an empty value all leave it off.
DEMO_SITE = env_flag("DEMO_SITE", default=False)


# analyze files to detect embedded media (e.g. in motion photos)
FEATURE_PROCESS_EMBEDDED_MEDIA = env_flag(
    "FEATURE_PROCESS_EMBEDDED_MEDIA", default=True
)

# Deploy-time feature switches. They all default to on, so an upgrade changes
# nothing; set one to false/0/no/off to stop that work from being done at all.
FEATURE_VIDEO = env_flag("FEATURE_VIDEO", default=True)
FEATURE_FACE_DETECTION = env_flag("FEATURE_FACE_DETECTION", default=True)
FEATURE_FACE_CLUSTER = env_flag("FEATURE_FACE_CLUSTER", default=True)
FEATURE_IMAGE_CAPTIONING = env_flag("FEATURE_IMAGE_CAPTIONING", default=True)
FEATURE_REVERSE_GEOCODING = env_flag("FEATURE_REVERSE_GEOCODING", default=True)
FEATURE_SCENE_CLASSIFICATION = env_flag("FEATURE_SCENE_CLASSIFICATION", default=True)
# Animated grid previews of videos; off, a video's squares are a still frame.
FEATURE_VIDEO_PREVIEWS = env_flag("FEATURE_VIDEO_PREVIEWS", default=True)

# Whether a user's Nextcloud server address may resolve to a private network
# address (LAN, Docker network, Tailscale). On by default because that is where
# most self-hosted Nextcloud instances live; loopback, link-local and other
# special addresses are refused either way. See nextcloud/server_address.py.
NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES = env_flag(
    "NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES", default=True
)
# A PEM file of certificates to check Nextcloud servers' TLS certificates
# against instead of the public authorities, for a Nextcloud with a self-signed
# certificate or one from a private CA. Empty: the public authorities.
# Checking cannot be switched off. See nextcloud/server_address.py.
NEXTCLOUD_CA_BUNDLE = env_str("NEXTCLOUD_CA_BUNDLE").strip()

# The name the proxy reaches the backend by. Requests carrying it (or the
# compose service name) come from inside the deployment, so api/accounts/public_url.py
# does not build public links from them.
BACKEND_HOST = env_str("BACKEND_HOST", "backend")
INTERNAL_HOSTS = frozenset({"backend", BACKEND_HOST})
ALLOWED_HOSTS = ["localhost", BACKEND_HOST]

# The build this process runs, as the images report it (deploy/docker sets both
# at build time; librephotos/standalone.py from the release's build info). Blank
# from a source checkout, where api/views/server_info.py asks git instead.
IMAGE_TAG = env_str("IMAGE_TAG")
GIT_HASH = env_str("GIT_HASH")

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": datetime.timedelta(minutes=5),
    "REFRESH_TOKEN_LIFETIME": datetime.timedelta(days=env_int("REFRESH_TOKEN_DAYS", 7)),
}

# Give the auth cookies the Secure flag even when the request looks like plain
# HTTP, as it does behind a TLS proxy (SECURE_PROXY_SSL_HEADER is not set). Off
# by default: browsers drop Secure cookies over plain HTTP. See api/accounts/cookies.py.
AUTH_COOKIE_SECURE = env_flag("AUTH_COOKIE_SECURE", default=False)

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
    # The OpenAPI schema: apps/backend/openapi.yaml is generated from it
    # (`manage.py spectacular`, checked in test-backend.yml) and the api-client
    # contract test compares the zod schemas with it. Its routes are mounted
    # only under DEBUG (librephotos/urls.py); the app has no models or
    # middleware, so a deployment only pays for the import.
    "drf_spectacular",
    # OIDC / SSO via django-allauth. The generic openid_connect provider handles
    # any standards-compliant IdP (Keycloak, Authentik, Authelia, Zitadel, Google,
    # Azure, ...). Provider credentials live in the DB (admin-editable SocialApp),
    # not the environment. See api/accounts/adapters.py for the login/linking policy and
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
    # Schedules missed while the workers were busy (the minutely service
    # check, during a scan) are skipped rather than run back to back once the
    # queue drains: five service checks in the same second restart the same
    # sidecar five times.
    "catch_up": False,
}

# Number of background workers doing the heavy lifting (thumbnails, face
# detection, captioning). Left unset, django-q falls back to cpu_count(), which
# reports the *host's* cores even when the container is capped with a compose
# `cpus:` limit - so the pool stays just as wide and the limit only starves it.
# Setting this is the way to actually reduce LibrePhotos' CPU and RAM appetite.
_WORKER_CONCURRENCY = env_int("WORKER_CONCURRENCY", None)
if _WORKER_CONCURRENCY is not None:
    Q_CLUSTER["workers"] = _WORKER_CONCURRENCY

# Hours a job may go without reporting progress before the hourly cleanup
# marks it failed and stops counting it as running (#1919, #2248). Counted from
# its last progress, not its start: a first scan of a large library on slow
# hardware takes days. Raise it where one item can take longer than this.
STUCK_JOB_HOURS = max(1, env_int("STUCK_JOB_HOURS", 24))

CONSTANCE_BACKEND = "constance.backends.database.DatabaseBackend"
CONSTANCE_ADDITIONAL_FIELDS = {
    "map_api_provider": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                ("exiftool", "ExifTool (offline, built in)"),
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
    "auto_scan": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                ("off", "Off"),
                ("hourly", "Every hour"),
                ("daily", "Every day"),
                ("custom", "On the days in AUTO_SCAN_DAYS"),
            ),
        },
    ],
    "captioning_model": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                ("none", "None"),
                ("lfm2_vl_450m", "LFM2.5-VL (default)"),
            ),
        },
    ],
    "ocr_model": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                # Lowercase "none" mirrors the captioning_model sibling; the "None"
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
            # The InsightFace model packs carried by api.runtime.ml_models.ML_MODELS
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
        # A blank ALLOW_UPLOAD has always meant "on", like leaving it unset.
        env_flag("ALLOW_UPLOAD", default=True, empty=True),
        "Allow uploading files",
        bool,
    ),
    "NEXTCLOUD_ENABLED": (
        # Off by default. Up to 1.3.0 the single letter "t" also switched it on;
        # it is read like every other switch now (see librephotos/env.py), and
        # "t" counts as off with a warning in the log.
        env_flag("NEXTCLOUD_ENABLED", default=False),
        "Enable the Nextcloud integration",
        bool,
    ),
    "AUTO_CREATE_USER_DIRECTORY": (
        False,
        "Give each new user their own folder under the data root and set it as"
        " their scan directory. Needs the admin's own scan directory to be a"
        " subfolder, not the data root itself, since scan directories of"
        " different users cannot overlap.",
        bool,
    ),
    "SKIP_PATTERNS": (
        env_str("SKIP_PATTERNS", ""),
        "Comma delimited list of patterns to ignore (e.g. '@eaDir,#recycle' for synology devices)",
        str,
    ),
    "SCAN_MISSING_MAX_FRACTION": (
        0.5,
        "Largest share of a user's photos (0 to 1) a scan may flag as missing at"
        " once. Above it, and above 100 photos, the scan changes nothing and asks"
        " whether the library is mounted. 1 turns the check off.",
        float,
    ),
    "TRASH_RETENTION_DAYS": (
        0,
        "Days a photo stays in the trash before it is deleted for good, files"
        " included. 0 keeps photos in the trash until their owner empties it.",
        int,
    ),
    # The automatic library scan (#235, api/directory_watcher/scan_schedule.py).
    # Saving them in the site settings rewrites its django-q schedule; so does
    # start_cleaning_service when the server starts.
    "AUTO_SCAN": (
        "off",
        "Scan every user's library for new and changed files automatically:"
        " off, every hour, every day, or on the days in AUTO_SCAN_DAYS.",
        "auto_scan",
    ),
    "AUTO_SCAN_TIME": (
        "03:00",
        "When a daily or custom automatic scan starts, HH:MM in the server's"
        " time zone (TIME_ZONE).",
        str,
    ),
    "AUTO_SCAN_DAYS": (
        "0,1,2,3,4",
        "The days a custom automatic scan runs, comma separated: 0 is Monday,"
        " 6 is Sunday.",
        str,
    ),
    "AUTO_SCAN_LAST_RUN": (
        "",
        "Written by the automatic scan, not a setting: when it last ran and"
        " which libraries it scanned, skipped or could not start (JSON).",
        str,
    ),
    "MAP_API_PROVIDER": (
        env_str("MAP_API_PROVIDER", "exiftool"),
        "Map Provider",
        "map_api_provider",
    ),
    "MAP_API_KEY": (env_str("MAPBOX_API_KEY", ""), "Map Box API Key", str),
    "MAP_TILE_PROVIDER": (
        env_str("MAP_TILE_PROVIDER", "photoprism"),
        "Map tile provider (map background shown behind photo pins)",
        "map_tile_provider",
    ),
    "CAPTIONING_MODEL": (
        "lfm2_vl_450m",
        "Captioning model",
        "captioning_model",
    ),
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
    # Site switches for the optional features (api/runtime/features.py). The
    # FEATURE_* environment variable above is a hard off; while it allows a
    # feature, these decide, without a restart.
    "VIDEO_ENABLED": (True, "Import video files during a scan", bool),
    "FACE_DETECTION_ENABLED": (True, "Find faces in photos", bool),
    "FACE_CLUSTER_ENABLED": (
        True,
        "Group the faces found into people to label",
        bool,
    ),
    "IMAGE_CAPTIONING_ENABLED": (
        True,
        "Describe photos with a generated caption",
        bool,
    ),
    "REVERSE_GEOCODING_ENABLED": (
        True,
        "Turn GPS coordinates into place names",
        bool,
    ),
    "SCENE_CLASSIFICATION_ENABLED": (
        True,
        "Detect what is in photos (beach, kitchen, sunset) for the Things albums",
        bool,
    ),
    "VIDEO_PREVIEWS_ENABLED": (
        True,
        "Make a short silent clip of each video for the photo grid; off, the"
        " grid shows a still frame and scans skip encoding the clip",
        bool,
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

DEFAULT_THROTTLE_RATES: dict[str, str] = {
    "password_reset": env_str("PASSWORD_RESET_THROTTLE_RATE", "5/hour"),
    # Sign-in (per address and username), sign-up, password reset confirm.
    "auth": env_str("AUTH_THROTTLE_RATE", "10/minute"),
    "token_refresh": env_str("TOKEN_REFRESH_THROTTLE_RATE", "60/minute"),
}

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "api.accounts.authentication.ThrottledBasicAuthentication",
    ),
    # api.drf.openapi.AutoSchema: responses of model serializers list every field
    # as required, which is what DRF writes.
    "DEFAULT_SCHEMA_CLASS": "api.drf.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": ("django_filters.rest_framework.DjangoFilterBackend",),
    # One pagination style for every list (api/drf/pagination.py, #2327).
    "DEFAULT_PAGINATION_CLASS": "api.drf.pagination.DefaultPagination",
    "EXCEPTION_HANDLER": "api.views.exception_handler.custom_exception_handler",
    "PAGE_SIZE": 100,
    # How many reverse proxies in front of the backend append the client
    # address to X-Forwarded-For; the throttles count per address
    # (api/accounts/throttling.py). 1 is the bundled proxy; 0 when clients connect
    # directly, so a client-sent header is ignored; 2 for a proxy in front of
    # the bundled one. DRF's own default, None, trusted the whole header, which
    # let every request pick its own counter.
    "NUM_PROXIES": max(0, env_int("NUM_PROXIES", 1)),
    "DEFAULT_THROTTLE_RATES": DEFAULT_THROTTLE_RATES,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "LibrePhotos API",
    "DESCRIPTION": (
        "The REST API of the LibrePhotos backend, used by the web app and the "
        "mobile app. Generated from the DRF serializers and views; "
        "packages/api-client checks its zod schemas against it."
    ),
    # The document's version, not the release: a release number here would
    # rewrite openapi.yaml on every release without the API changing.
    "VERSION": "1.0.0",
    # Separate request and response components (PhotoRequest vs Photo), so a
    # read-only field is required in the response instead of optional in both.
    "COMPONENT_SPLIT_REQUEST": True,
    # Enum components are named after their field; a name that says whose
    # status this is keeps it stable when another "status" choice appears.
    "ENUM_NAME_OVERRIDES": {
        "HealthStatusEnum": "api.serializers.health.HEALTH_STATES",
        # A stack's type, and the narrower set the stack list returns.
        "StackTypeEnum": "api.serializers.stack.STACK_TYPES",
        "ListedStackTypeEnum": "api.serializers.stack.LISTED_STACK_TYPES",
        # A synced photo's kind (image, video, motion).
        "SyncMediaTypeEnum": "api.serializers.sync_responses.SYNC_MEDIA_TYPES",
        # What a memory is about (years_ago, month_years_ago).
        "MemoryTypeEnum": "api.serializers.memories.MEMORY_TYPES",
        # What the serving diagnostics found.
        "MediaDiagnosisCauseEnum": "api.serializers.media.DIAGNOSIS_CAUSES",
        # A person's kind keeps its name now that another "kind" choice exists.
        "KindEnum": "api.serializers.face.PERSON_KINDS",
        # A file of the All metadata view: the media file or a sidecar.
        "RawMetadataFileKindEnum": "api.serializers.photo_metadata.RAW_METADATA_FILE_KINDS",
        # What "Write metadata to files" writes, and where (#2287).
        "MetadataWriteTypeEnum": "api.serializers.photos.METADATA_WRITE_TYPES",
        "MetadataWriteTargetEnum": "api.serializers.photos.METADATA_WRITE_TARGETS",
        # Moving photos to another folder (#352): a taken name, a refused photo.
        "MoveOnConflictEnum": "api.serializers.photo_moves.ON_CONFLICT_CHOICES",
        "MoveRefusalReasonEnum": "api.serializers.photo_moves.MOVE_REFUSAL_REASONS",
    },
    "POSTPROCESSING_HOOKS": [
        "drf_spectacular.hooks.postprocess_schema_enums",
        "api.drf.openapi.require_page_keys",
    ],
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

# DB_PASS used to fall back to the password shipped in librephotos.env without a
# word. Every bundled deployment (Compose, the unified image docs, Kubernetes)
# passes DB_PASS, but a hand-written setup that never did still connects with
# this value, so it stays as the fallback rather than breaking those installs on
# upgrade. The librephotos.W001 system check (api/checks.py) says so whenever
# PostgreSQL is actually used with it, which `migrate` prints on every start.
INSECURE_DEFAULT_DB_PASSWORD = "AaAa1234"
_DB_PASS = env_str("DB_PASS", None)
DB_PASS_FROM_ENV = _DB_PASS is not None

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env_str("DB_NAME", "db"),
        "USER": env_str("DB_USER", "docker"),
        "PASSWORD": INSECURE_DEFAULT_DB_PASSWORD if _DB_PASS is None else _DB_PASS,
        "HOST": env_str("DB_HOST", "db"),
        "PORT": env_str("DB_PORT", "5432"),
        # Using persistent connections instead of pooling due to Django 5.2 pooling bugs
        # (type conversion issues with COUNT queries - see error with UUID returned as string)
        "CONN_MAX_AGE": 600,
        "CONN_HEALTH_CHECKS": True,
    },
}

# SQLite only: how many of the backups made before a migration (manage.py
# backup_database, api/runtime/db_backup.py) stay in BASE_DATA/backups.
DB_BACKUP_KEEP = max(1, env_int("DB_BACKUP_KEEP", 3))

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

# The split dev setup's frontend, plus the operator's own origins as a
# comma-separated list (each with its scheme, e.g. https://photos.example.com).
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:3000",
    *env_list("CSRF_TRUSTED_ORIGINS"),
]

# The whole log configuration lives in librephotos/logging_bootstrap.py so the
# non-Django processes can share it. LOG_LEVEL, LOG_LEVELS (per-logger
# overrides, parsed inside build_logging_config) and LOG_TO_CONSOLE are read from
# the environment rather than from constance: the qcluster workers and the ML
# services need the same answer and several of them never touch the database.
# Rotation size and backup count start at the defaults here and are refined from
# constance once the database is up (see api.apps.reconfigure_logging).
LOGGING = build_logging_config(
    logs_root=LOGS_ROOT,
    level=env_str("LOG_LEVEL", None),
    to_console=resolve_to_console(),
)

CHUNKED_UPLOAD_PATH = ""
CHUNKED_UPLOAD_TO = os.path.join("chunked_uploads")

# The rating a photo needs to count as a favourite, for a user created from now on
# (User.favorite_min_rating defaults to it). A constant, not an environment
# variable: the field default is in the migrations, so an install that changed it
# had models that no longer matched them. Each user sets their own in Settings.
DEFAULT_FAVORITE_MIN_RATING = 4

# Email / SMTP configuration.
#
# Outgoing mail is configured at runtime from the database (the admin Site
# Settings UI), not the environment. `DynamicEmailBackend` reads the stored
# `EmailConfig` at send time and delegates to Django's SMTP backend; when email
# is unconfigured it is a safe no-op (or the console backend under DEBUG, so
# reset links still appear in dev logs). This keeps the SMTP credential
# encrypted at rest and editable without a redeploy. See api/accounts/mail.py.
EMAIL_BACKEND = "api.accounts.mail.DynamicEmailBackend"
# Fallback from-address when the admin has not set one; the stored config value
# takes precedence (see EmailConfig.effective_from_email).
DEFAULT_FROM_EMAIL = env_str("DEFAULT_FROM_EMAIL", "LibrePhotos <no-reply@localhost>")

# Base URL of the frontend, used to build the link in the password-reset email.
# Falls back to the request's own origin when not set (see PasswordResetView).
FRONTEND_BASE_URL = env_str("FRONTEND_BASE_URL", "")

# ---------------------------------------------------------------------------
# django-allauth (OIDC / SSO) — see api/accounts/adapters.py and api/views/sso.py
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
SOCIALACCOUNT_ADAPTER = "api.accounts.adapters.SSOSocialAccountAdapter"
ACCOUNT_ADAPTER = "api.accounts.adapters.NoLocalSignupAccountAdapter"

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
