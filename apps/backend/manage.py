#!/usr/bin/env python
import os
import sys

if __name__ == "__main__":
    environment = "production"
    if os.environ.get("DEBUG", "0") == "1":
        environment = "development"

    try:
        command = sys.argv[1]
    except IndexError:
        command = "help"

    do_not_collect_coverage = os.environ.get("NO_COVERAGE") is not None
    running_tests = command == "test"
    if running_tests:
        environment = "test"
    if running_tests and not do_not_collect_coverage:
        from coverage import Coverage

        cov = Coverage()
        cov.erase()
        cov.start()

    from django.core.management import execute_from_command_line

    os.environ.setdefault(
        "DJANGO_SETTINGS_MODULE", f"librephotos.settings.{environment}"
    )
    execute_from_command_line(sys.argv)

    if running_tests and not do_not_collect_coverage:
        cov.stop()
        cov.save()
        cov.html_report()
        covered = cov.report()
