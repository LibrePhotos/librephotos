#!/usr/bin/env python
import os
import sys
from coverage import Coverage

def setup_environment():
    """
    Set up the environment variables and command for the script.
    """
    environment = "production"
    if os.environ.get("DEBUG", "0") == "1":
        environment = "development"
    
    try:
        command = sys.argv[1]
    except IndexError:
        command = "help"
    
    do_not_collect_coverage = os.environ.get("NO_COVERAGE") is not None
    running_tests = command == "test"
    
    return environment, command, do_not_collect_coverage, running_tests

def run_tests_with_coverage():
    """
    Run tests with coverage measurement and generate coverage reports.
    """
    cov = Coverage()
    cov.erase()
    cov.start()
    
    # Run tests
    from django.core.management import execute_from_command_line
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", f"librephotos.settings.test")
    execute_from_command_line(sys.argv)
    
    # Stop coverage measurement and generate reports
    cov.stop()
    cov.save()
    cov.html_report()
    covered = cov.report()

if __name__ == "__main__":
    environment, command, do_not_collect_coverage, running_tests = setup_environment()
    
    try:
        if running_tests and not do_not_collect_coverage:
            run_tests_with_coverage()
        else:
            # Run the command
            from django.core.management import execute_from_command_line
            os.environ.setdefault("DJANGO_SETTINGS_MODULE", f"librephotos.settings.{environment}")
            execute_from_command_line(sys.argv)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
