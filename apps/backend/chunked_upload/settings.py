import time
import os.path
from datetime import timedelta
from django.utils.module_loading import import_string
from django.conf import settings

try:
    from django.core.serializers.json import DjangoJSONEncoder
except ImportError:
    try:
        # Deprecated class name (for backwards compatibility purposes)
        from django.core.serializers.json import (
            DateTimeAwareJSONEncoder as DjangoJSONEncoder
        )
    except ImportError:
        raise ImportError('Dude! what version of Django are you using?')

# How long after creation the upload will expire
DEFAULT_EXPIRATION_DELTA = timedelta(days=1)
EXPIRATION_DELTA = getattr(settings, 'CHUNKED_UPLOAD_EXPIRATION_DELTA',
                           DEFAULT_EXPIRATION_DELTA)

# Path where uploading files will be stored until completion
DEFAULT_UPLOAD_PATH = 'chunked_uploads/%Y/%m/%d'
UPLOAD_PATH = getattr(settings, 'CHUNKED_UPLOAD_PATH', DEFAULT_UPLOAD_PATH)


# upload_to function to be used in the FileField
def default_upload_to(instance, filename):
    filename = os.path.join(UPLOAD_PATH, instance.upload_id + '.part')
    return time.strftime(filename)


UPLOAD_TO = getattr(settings, 'CHUNKED_UPLOAD_TO', default_upload_to)

# Storage system


try:
    STORAGE = getattr(settings, 'CHUNKED_UPLOAD_STORAGE_CLASS', lambda: None)()
except TypeError:
    STORAGE = import_string(getattr(settings, 'CHUNKED_UPLOAD_STORAGE_CLASS', lambda: None))()

# Function used to encode response data. Receives a dict and return a string
DEFAULT_ENCODER = DjangoJSONEncoder().encode
ENCODER = getattr(settings, 'CHUNKED_UPLOAD_ENCODER', DEFAULT_ENCODER)

# Content-Type for the response data
DEFAULT_CONTENT_TYPE = 'application/json'
CONTENT_TYPE = getattr(settings, 'CHUNKED_UPLOAD_CONTENT_TYPE',
                       DEFAULT_CONTENT_TYPE)

# Max amount of data (in bytes) that can be uploaded. `None` means no limit
DEFAULT_MAX_BYTES = None
MAX_BYTES = getattr(settings, 'CHUNKED_UPLOAD_MAX_BYTES', DEFAULT_MAX_BYTES)

# determine the "null" and "blank" properties of "user" field in the "ChunkedUpload" model
DEFAULT_MODEL_USER_FIELD_NULL = getattr(settings, 'CHUNKED_UPLOAD_MODEL_USER_FIELD_NULL', True)
DEFAULT_MODEL_USER_FIELD_BLANK = getattr(settings, 'CHUNKED_UPLOAD_MODEL_USER_FIELD_BLANK', True)
