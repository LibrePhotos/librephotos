"""
This module peovides initializer function
without importing anything at the module level.
This allows to set env vars suxh as OMP_NUM_THREADS.
It is important that spawn context is used, because
with fork new processes will get modules like torch
initialized from the parent process with env vars
having no effect.
"""

def initialize_scan_process(num_threads, method):
    """
    Each process will have its own exiftool instance
    so we need to start _and_ stop it for each process.
    multiprocessing.util.Finalize is _undocumented_ and
    should perhaps not be relied on but I found no other
    way. (See https://stackoverflow.com/a/24724452)

    """
    if num_threads is not None:
        import os
        os.environ["OMP_NUM_THREADS"] = str(num_threads)

    if method == "spawn":
        import django
        django.setup()

    from multiprocessing.util import Finalize

    from api.util import exiftool_instance

    et = exiftool_instance.__enter__()

    def terminate(et):
        et.terminate()

    Finalize(et, terminate, args=(et,), exitpriority=16)


