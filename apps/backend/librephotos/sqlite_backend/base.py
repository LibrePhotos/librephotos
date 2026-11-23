"""Django's SQLite backend, except that a queryset's rows are read before its loop.

With chunked reads, ``.iterator()`` keeps its SELECT open while the loop body
runs, so a write from the loop upgrades that open read to a write. SQLite
refuses the upgrade at once with "database is locked" when another connection
committed since the read began (SQLITE_BUSY_SNAPSHOT), whatever the busy
timeout. The scan workers commit all the time, so a loop that writes per row
(metadata write-back, cancelling queued tasks) failed on a busy instance.
"""

from django.db.backends.sqlite3 import base, features


class DatabaseFeatures(features.DatabaseFeatures):
    can_use_chunked_reads = False


class DatabaseWrapper(base.DatabaseWrapper):
    features_class = DatabaseFeatures
