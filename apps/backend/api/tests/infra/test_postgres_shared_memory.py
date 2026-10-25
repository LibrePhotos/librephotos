"""Postgres gets more than the container runtime's 64 MB of /dev/shm (#2868).

Parallel queries keep their shared memory in /dev/shm. At Docker's default of
64 MB a few of them at once on a large library failed requests with "could not
resize shared memory segment ... No space left on device", an intermittent 500
on whatever page ran the last one. The compose files set ``shm_size`` on the
``db`` service (the unified file is held to the same value by
``test_compose_files_in_sync.py``), and the Kubernetes manifest mounts a
memory-backed ``emptyDir`` at /dev/shm. Both are ceilings: memory is used only
for what Postgres allocates.
"""

import unittest

import yaml
from django.test import SimpleTestCase

from api.tests.infra.deploy_files import (
    COMPOSE_DIR,
    DEPLOY_DIR,
    compose_service,
    load_compose,
    repository_present,
)

SHM_SIZE = "256mb"
K8S_SHM_LIMIT = "256Mi"


@unittest.skipUnless(repository_present(), "needs the repository checkout (deploy/)")
class PostgresSharedMemoryTest(SimpleTestCase):
    def test_compose_db_sets_shm_size(self):
        compose = load_compose(
            (COMPOSE_DIR / "docker-compose.yml").read_text(encoding="utf-8")
        )
        self.assertEqual(SHM_SIZE, compose_service(compose, "db").get("shm_size"))

    def test_k8s_postgres_mounts_a_memory_backed_dev_shm(self):
        documents = yaml.safe_load_all(
            (DEPLOY_DIR / "k8s" / "db.yaml").read_text(encoding="utf-8")
        )
        deployment = next(d for d in documents if d and d.get("kind") == "Deployment")
        pod = deployment["spec"]["template"]["spec"]
        (container,) = [c for c in pod["containers"] if c["name"] == "postgres"]
        mounts = {m["mountPath"]: m["name"] for m in container["volumeMounts"]}
        self.assertIn("/dev/shm", mounts)
        volumes = {v["name"]: v for v in pod["volumes"]}
        self.assertEqual(
            {"medium": "Memory", "sizeLimit": K8S_SHM_LIMIT},
            volumes[mounts["/dev/shm"]].get("emptyDir"),
        )
