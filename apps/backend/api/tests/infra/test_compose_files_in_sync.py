"""The unified compose file passes the backend what the standard one passes (issue #2374).

``deploy/compose/docker-compose.yml`` (proxy, frontend and backend images) and
``deploy/compose/docker-compose.unified.yml`` (the single-container image) are
both driven by ``deploy/compose/librephotos.env``. Every backend variable has to
be added to both: a variable that only one of them forwards is a ``.env``
setting that silently does nothing for the other deployment. Until this test
existed the unified file had fallen eleven variables behind and still mounted
the database at the path that breaks from Postgres 18 on.

Checked here:

* the backend ``environment`` sets the same variables, apart from
  ``ALLOWED_DIFFERENCES``;
* each shared variable has the same ``${key:-default}`` expression;
* the backend has the same healthcheck (on ``/api/healthz/ready``, #2310);
* the ``db`` service runs the same image with the same volume target;
* the old ``build-unified.sh`` script is gone and nothing under ``deploy/``
  points at it.

The Kubernetes config (``deploy/k8s/config/backend.env``) is maintained by hand
on purpose and stays out. Without the repository checkout (inside the backend
image) the file checks skip; the comparison itself is tested on planted text.
"""

import unittest

from django.test import SimpleTestCase

from api.tests.infra.deploy_files import (
    COMPOSE_DIR,
    DEPLOY_DIR,
    compose_service,
    load_compose,
    repository_present,
    service_environment,
    volume_target,
)

STANDARD = COMPOSE_DIR / "docker-compose.yml"
UNIFIED = COMPOSE_DIR / "docker-compose.unified.yml"
BACKEND = "backend"
DATABASE = "db"
REMOVED_SCRIPT = "build-unified.sh"

# Backend variables only one of the two files sets, with the reason.
ALLOWED_DIFFERENCES = {
    "SERVE_FRONTEND": "unified image only: Django serves the web app, there is no proxy or frontend container",
}


def compose_drift(standard_text: str, unified_text: str) -> list[str]:
    """Every way the unified compose file differs from the standard one."""
    standard = load_compose(standard_text)
    unified = load_compose(unified_text)
    problems: list[str] = []

    standard_env = service_environment(compose_service(standard, BACKEND))
    unified_env = service_environment(compose_service(unified, BACKEND))
    for name in sorted(set(standard_env) - set(unified_env) - set(ALLOWED_DIFFERENCES)):
        problems.append(f"{name} is set in the standard file only")
    for name in sorted(set(unified_env) - set(standard_env) - set(ALLOWED_DIFFERENCES)):
        problems.append(f"{name} is set in the unified file only")
    for name in sorted(set(standard_env) & set(unified_env)):
        if standard_env[name] != unified_env[name]:
            problems.append(
                f"{name}: {standard_env[name]!r} (standard) != {unified_env[name]!r} (unified)"
            )

    standard_check = compose_service(standard, BACKEND).get("healthcheck")
    unified_check = compose_service(unified, BACKEND).get("healthcheck")
    if standard_check != unified_check:
        problems.append(
            f"backend healthcheck: {standard_check!r} (standard) != {unified_check!r} (unified)"
        )

    standard_db = compose_service(standard, DATABASE)
    unified_db = compose_service(unified, DATABASE)
    if standard_db.get("image") != unified_db.get("image"):
        problems.append(
            f"db image: {standard_db.get('image')!r} (standard) != {unified_db.get('image')!r} (unified)"
        )
    standard_targets = sorted(
        volume_target(v) for v in standard_db.get("volumes") or []
    )
    unified_targets = sorted(volume_target(v) for v in unified_db.get("volumes") or [])
    if standard_targets != unified_targets:
        problems.append(
            f"db volume targets: {standard_targets} (standard) != {unified_targets} (unified)"
        )
    return problems


class ComposeDriftDetectionTest(SimpleTestCase):
    """The comparison itself, on planted files."""

    BASE = """
services:
  db:
    image: pgautoupgrade/pgautoupgrade:18-alpine
    volumes:
      - ${data}/db:/var/lib/postgresql
  backend:
    environment:
      - LOG_LEVEL=${logLevel:-INFO}
      - BASE_LOGS=${baseLogs:-/logs}
"""

    def test_identical_files_do_not_drift(self):
        self.assertEqual([], compose_drift(self.BASE, self.BASE))

    def test_a_variable_in_one_file_only_is_drift(self):
        planted = self.BASE + "      - FOO=${foo:-1}\n"
        self.assertEqual(
            ["FOO is set in the unified file only"], compose_drift(self.BASE, planted)
        )
        self.assertEqual(
            ["FOO is set in the standard file only"], compose_drift(planted, self.BASE)
        )

    def test_a_different_default_is_drift(self):
        planted = self.BASE.replace("${logLevel:-INFO}", "${logLevel:-DEBUG}")
        self.assertEqual(1, len(compose_drift(self.BASE, planted)))

    def test_an_allowed_difference_is_not_drift(self):
        planted = self.BASE + "      - SERVE_FRONTEND=true\n"
        self.assertEqual([], compose_drift(self.BASE, planted))

    def test_a_different_db_volume_target_is_drift(self):
        planted = self.BASE.replace(
            "${data}/db:/var/lib/postgresql",
            "${data}/dbcursor:/var/lib/postgresql/data",
        )
        self.assertEqual(1, len(compose_drift(self.BASE, planted)))

    def test_a_different_db_volume_source_is_not_drift(self):
        """The unified file keeps its own data directory name (dbcursor)."""
        planted = self.BASE.replace("${data}/db:", "${data}/dbcursor:")
        self.assertEqual([], compose_drift(self.BASE, planted))

    def test_a_different_backend_healthcheck_is_drift(self):
        planted = self.BASE + "    healthcheck:\n      test: probe\n"
        self.assertEqual(
            ["backend healthcheck: None (standard) != {'test': 'probe'} (unified)"],
            compose_drift(self.BASE, planted),
        )
        self.assertEqual([], compose_drift(planted, planted))

    def test_a_different_db_image_is_drift(self):
        planted = self.BASE.replace("18-alpine", "17-alpine")
        self.assertEqual(1, len(compose_drift(self.BASE, planted)))

    def test_volume_target_ignores_colons_inside_interpolations(self):
        self.assertEqual(
            "${baseLogs:-/logs}", volume_target("${data}/logs:${baseLogs:-/logs}")
        )
        self.assertEqual("/data", volume_target("${scanDirectory}:/data:ro"))


@unittest.skipUnless(
    repository_present(), "needs the repository checkout (deploy/ and the docs page)"
)
class ComposeFilesInSyncTest(SimpleTestCase):
    def test_unified_compose_file_lives_next_to_librephotos_env(self):
        """`cp librephotos.env .env` has to work for both deployments."""
        self.assertTrue(UNIFIED.is_file(), f"{UNIFIED} is missing")
        self.assertTrue((COMPOSE_DIR / "librephotos.env").is_file())
        self.assertEqual([], sorted(DEPLOY_DIR.rglob("docker-compose.no-proxy.yml")))

    def test_unified_compose_file_matches_the_standard_one(self):
        self.assertEqual(
            [],
            compose_drift(
                STANDARD.read_text(encoding="utf-8"),
                UNIFIED.read_text(encoding="utf-8"),
            ),
        )

    def test_allowed_differences_still_differ(self):
        standard = service_environment(
            compose_service(load_compose(STANDARD.read_text(encoding="utf-8")), BACKEND)
        )
        unified = service_environment(
            compose_service(load_compose(UNIFIED.read_text(encoding="utf-8")), BACKEND)
        )
        stale = sorted(
            name
            for name in ALLOWED_DIFFERENCES
            if (name in standard) == (name in unified)
        )
        self.assertEqual(
            [], stale, "ALLOWED_DIFFERENCES entries both files now agree on"
        )

    def test_build_unified_script_is_gone(self):
        self.assertEqual([], sorted(DEPLOY_DIR.rglob(REMOVED_SCRIPT)))
        mentions = sorted(
            path.relative_to(DEPLOY_DIR).as_posix()
            for path in DEPLOY_DIR.rglob("*")
            if path.is_file()
            and REMOVED_SCRIPT in path.read_text(encoding="utf-8", errors="ignore")
        )
        self.assertEqual(
            [], mentions, f"files under deploy/ that mention {REMOVED_SCRIPT}"
        )
