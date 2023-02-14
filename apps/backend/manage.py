#!/usr/bin/env python
import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ownphotos.settings")

    try:
        command = sys.argv[1]
    except IndexError:
        command = "help"

    running_tests = command == "test"
    if running_tests:
        from coverage import Coverage

        cov = Coverage()
        cov.erase()
        cov.start()

    try:
        from django.core.management import execute_from_command_line
    except ImportError:
        raise
    execute_from_command_line(sys.argv)

    if running_tests:
        cov.stop()
        cov.save()
        cov.html_report()
        covered = cov.report()
        # if covered < 100:
        #     raise SystemExit(1)
