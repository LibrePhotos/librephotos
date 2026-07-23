import os
import sys

# This is a standalone Flask process, started as `python image_similarity/main.py`
# (see api/services.py), so sys.path[0] is this directory and the backend root -
# where the librephotos package lives - is not importable yet. Django is never
# loaded here; logging_bootstrap is deliberately Django-free so that the service
# still writes records of exactly the shape the rest of the stack writes.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from librephotos.logging_bootstrap import configure_standalone  # noqa: E402

# Still its own file for now; folding it into the shared log is a follow-up.
# BASE_LOGS and LOG_LEVEL come from the environment the parent hands down.
logger = configure_standalone("image_similarity", filename="image_similarity.log")
