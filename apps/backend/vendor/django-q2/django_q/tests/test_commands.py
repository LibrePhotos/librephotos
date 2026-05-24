import pytest
from django.core.management import call_command


@pytest.mark.django_db
def test_qcluster():
    call_command("qcluster", run_once=True)


@pytest.mark.django_db
def test_qmonitor():
    call_command("qmonitor", run_once=True)


@pytest.mark.django_db
def test_qinfo():
    call_command("qinfo")
    call_command("qinfo", config=True)
    call_command("qinfo", ids=True)


@pytest.mark.django_db
def test_qmemory():
    call_command("qmemory", run_once=True)
    call_command("qmemory", workers=True, run_once=True)
