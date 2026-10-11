"""Names scripts/check_dead_code.py must treat as used.

Entries may only be removed, never added to get the check green: delete dead
code instead. The one exception is code that something outside the scanned
Python calls by name (a dotted path in settings, a django_q schedule, a string
in a ModelAdmin), with the caller named in the comment.

Never imported; vulture reads ``_.name`` as a use of ``name``.
"""


class _Used:
    def __getattr__(self, name: str) -> None:
        return None


_ = _Used()

# Dotted paths in librephotos/settings/production.py.
_.NoLocalSignupAccountAdapter  # class in api/adapters.py (ACCOUNT_ADAPTER)
_.SSOSocialAccountAdapter  # class in api/adapters.py (SOCIALACCOUNT_ADAPTER)
_.DynamicEmailBackend  # class in api/mail.py (EMAIL_BACKEND)
_.custom_exception_handler  # function in api/views/exception_handler.py (REST_FRAMEWORK)

# App configs: api/__init__.py names ApiConfig, Django finds NextcloudConfig.
_.ApiConfig  # class in api/apps.py
_.NextcloudConfig  # class in nextcloud/apps.py

# django_q Schedule rows, created by dotted path in management commands.
_.check_services  # function in api/services.py (start_service)
_.cleanup_deleted_photos  # function in api/services.py (start_cleaning_service)
_.prune_deletion_log  # function in api/services.py (start_cleaning_service)
_.cleanup_stuck_jobs  # method in api/models/long_running_job.py (start_job_cleanup_service)
_.cleanup_old_jobs  # method in api/models/long_running_job.py (start_job_cleanup_service)

# Named by string.
_.deduplicate_faces  # method in api/admin.py (PhotoAdmin.actions)
_.megapixels  # property in api/models/photo_metadata.py (serializer ReadOnlyField)

# Test hooks that reset module-level caches between tests.
_.reset_probe_cache  # function in api/ffmpeg_budget.py
_.reset_for_tests  # function in api/geocode/rate_limit.py

# Dead: only tests call these. Delete them together with their tests, or
# point the tests at the function they wrap.
_.check_filename_pattern  # function in api/burst_detection_rules.py
_.get_face_locations  # function in api/face_recognition.py
_.resolution  # property in api/models/photo_metadata.py
_.create_for_stack  # method in api/models/stack_review.py
_.are_duplicates  # function in api/perceptual_hash.py
_.find_similar_hashes  # function in api/perceptual_hash.py
_.create_thumbnail  # function in api/thumbnails.py
_.is_safe_server_address  # function in nextcloud/server_address.py
