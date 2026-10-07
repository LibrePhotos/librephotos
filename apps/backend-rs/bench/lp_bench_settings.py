"""Django settings for the benchmark's qcluster and helper scripts: the reference
server settings (tests/fixture/lp_twin_settings.py, or lp_twin_settings_sqlite.py
when DB_BACKEND=sqlite), plus LP_Q_RECYCLE to
override the shipped qcluster worker recycling (50 tasks) for the tuned
variant."""

import os

if os.environ.get("DB_BACKEND") == "sqlite":
    from lp_twin_settings_sqlite import *  # noqa: F403
else:
    from lp_twin_settings import *  # noqa: F403

if os.environ.get("LP_Q_RECYCLE"):
    Q_CLUSTER = {**Q_CLUSTER, "recycle": int(os.environ["LP_Q_RECYCLE"])}  # noqa: F405
