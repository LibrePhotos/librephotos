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
_.NoLocalSignupAccountAdapter  # class in api/accounts/adapters.py (ACCOUNT_ADAPTER)
_.SSOSocialAccountAdapter  # class in api/accounts/adapters.py (SOCIALACCOUNT_ADAPTER)
_.DynamicEmailBackend  # class in api/accounts/mail.py (EMAIL_BACKEND)
_.custom_exception_handler  # function in api/views/exception_handler.py (REST_FRAMEWORK)
_.require_page_keys  # function in api/drf/openapi.py (SPECTACULAR_SETTINGS POSTPROCESSING_HOOKS)

# App configs: api/__init__.py names ApiConfig, Django finds NextcloudConfig.
_.ApiConfig  # class in api/apps.py
_.NextcloudConfig  # class in nextcloud/apps.py

# django_q Schedule rows, created by dotted path in management commands.
_.check_services  # function in api/runtime/supervisor.py (start_service)
_.empty_expired_trash  # function in api/photos/retention.py (start_cleaning_service)
_.cleanup_deleted_photos  # function in api/photos/retention.py (start_cleaning_service)
_.prune_deletion_log  # function in api/photos/retention.py (start_cleaning_service)
_.cleanup_stuck_jobs  # method in api/models/long_running_job.py (start_job_cleanup_service)
_.cleanup_old_jobs  # method in api/models/long_running_job.py (start_job_cleanup_service)

# drf-spectacular extensions: defining one registers it, nothing names it.
_.ThrottledBasicScheme  # class in api/drf/openapi.py (OpenApiAuthenticationExtension)

# Named by string.
_.deduplicate_faces  # method in api/admin.py (PhotoAdmin.actions)

# ModelAdmin hooks django.contrib.admin calls by name.
_.has_add_permission  # method in api/admin.py (LongRunningJobAdmin)
_.has_change_permission  # method in api/admin.py (LongRunningJobAdmin)
_.megapixels  # property in api/models/photo_metadata.py (serializer ReadOnlyField)

# Test hooks that reset module-level caches between tests.
_.reset_probe_cache  # function in api/video/ffmpeg_budget.py
_.reset_for_tests  # function in api/geocode/rate_limit.py

# Dead: only tests call these. Delete them together with their tests, or
# point the tests at the function they wrap.
_.check_filename_pattern  # function in api/stacks/burst_rules.py
_.get_face_locations  # function in api/faces/recognition.py
_.resolution  # property in api/models/photo_metadata.py
_.are_duplicates  # function in api/duplicates/perceptual_hash.py
_.find_similar_hashes  # function in api/duplicates/perceptual_hash.py
_.create_thumbnail  # function in api/thumbnails/render.py
_.is_safe_server_address  # function in nextcloud/server_address.py
