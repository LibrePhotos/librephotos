import pytest
from django.urls import reverse
from django.utils import timezone

from django_q.conf import Conf
from django_q.humanhash import uuid
from django_q.models import Failure, OrmQ, Task
from django_q.signing import SignedPackage
from django_q.tasks import schedule


@pytest.mark.django_db
def test_admin_views(admin_client, monkeypatch):
    monkeypatch.setattr(Conf, "ORM", "default")
    s = schedule("schedule.test")
    tag = uuid()
    f = Task.objects.create(
        id=tag[1],
        name=tag[0],
        func="test.fail",
        started=timezone.now(),
        stopped=timezone.now(),
        success=False,
    )
    tag = uuid()
    t = Task.objects.create(
        id=tag[1],
        name=tag[0],
        func="test.success",
        started=timezone.now(),
        stopped=timezone.now(),
        success=True,
    )
    q = OrmQ.objects.create(
        key="test",
        payload=SignedPackage.dumps({"id": 1, "func": "test", "name": "test"}),
    )
    admin_urls = (
        # schedule
        reverse("admin:django_q_schedule_changelist"),
        reverse("admin:django_q_schedule_add"),
        reverse("admin:django_q_schedule_change", args=(s.id,)),
        reverse("admin:django_q_schedule_history", args=(s.id,)),
        reverse("admin:django_q_schedule_delete", args=(s.id,)),
        # success
        reverse("admin:django_q_success_changelist"),
        reverse("admin:django_q_success_change", args=(t.id,)),
        reverse("admin:django_q_success_history", args=(t.id,)),
        reverse("admin:django_q_success_delete", args=(t.id,)),
        # failure
        reverse("admin:django_q_failure_changelist"),
        reverse("admin:django_q_failure_change", args=(f.id,)),
        reverse("admin:django_q_failure_history", args=(f.id,)),
        reverse("admin:django_q_failure_delete", args=(f.id,)),
        # orm queue
        reverse("admin:django_q_ormq_changelist"),
        reverse("admin:django_q_ormq_change", args=(q.id,)),
        reverse("admin:django_q_ormq_history", args=(q.id,)),
        reverse("admin:django_q_ormq_delete", args=(q.id,)),
    )
    for url in admin_urls:
        response = admin_client.get(url)
        assert response.status_code == 200

    # resubmit the failure
    url = reverse("admin:django_q_failure_changelist")
    data = {"action": "resubmit_task", "_selected_action": [f.pk]}
    response = admin_client.post(url, data)
    assert response.status_code == 302
    assert Failure.objects.filter(name=f.id).exists() is False
    # change q
    url = reverse("admin:django_q_ormq_change", args=(q.id,))
    data = {
        "key": "default",
        "payload": "test",
        "lock_0": "2015-09-17",
        "lock_1": "14:31:51",
        "_save": "Save",
    }
    response = admin_client.post(url, data)
    assert response.status_code == 302
    # delete q
    url = reverse("admin:django_q_ormq_delete", args=(q.id,))
    data = {"post": "yes"}
    response = admin_client.post(url, data)
    assert response.status_code == 302
    # Resubmit a successful task.
    url = reverse("admin:django_q_success_changelist")
    data = {"action": "resubmit_task", "_selected_action": [t.pk]}
    initial_queue_count = OrmQ.objects.count()
    response = admin_client.post(url, data)
    assert response.status_code == 302
    assert OrmQ.objects.count() > initial_queue_count
