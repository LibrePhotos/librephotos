"""The release path of .github/workflows/standalone-windows.yml (#2318, #2319, #2317).

A full run takes about three hours, so the workflow is only exercised on a
release. These guards keep the promises it makes to the download link: the
release becomes Latest only after the smoke test and the upload, nothing is
overwritten silently, and the asset names are the ones build_standalone.py writes.
"""

import importlib.util
import unittest

import yaml
from django.test import SimpleTestCase

from api.tests.infra.deploy_files import (
    BACKEND_ROOT,
    REPO_ROOT,
    WORKFLOWS_DIR,
    repository_present,
)
from api.tests.infra.test_standalone import load_build_script

WORKFLOW = WORKFLOWS_DIR / "standalone-windows.yml"
RELEASE_TEMPLATE = REPO_ROOT / ".github" / "release-notes-template.md"


class WorkflowSteps(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.text = WORKFLOW.read_text(encoding="utf-8")
        cls.workflow = yaml.safe_load(cls.text)
        cls.job = cls.workflow["jobs"]["build"]
        cls.steps = cls.job["steps"]
        cls.build = load_build_script()

    def step_index(self, name):
        names = [step.get("name") for step in self.steps]
        self.assertIn(name, names)
        return names.index(name)

    def run_of(self, name):
        return self.steps[self.step_index(name)]["run"]


@unittest.skipUnless(
    repository_present(), "needs the repository checkout (.github/workflows)"
)
class StandaloneWindowsWorkflowTest(WorkflowSteps):
    def test_latest_moves_only_after_the_smoke_test_and_the_upload(self):
        latest = self.step_index("Mark the release latest")

        self.assertLess(self.step_index("Smoke test"), latest)
        self.assertLess(self.step_index("Attach to the release"), latest)
        self.assertIn(
            'gh release edit "$TAG" --latest', self.run_of("Mark the release latest")
        )
        self.assertNotIn("--latest", self.run_of("Attach to the release"))

    def test_the_smoke_test_runs_the_zip_users_download(self):
        smoke = self.run_of("Smoke test")

        self.assertIn("scripts/smoke_standalone.py", smoke)
        self.assertIn('"build/standalone/$STABLE_ZIP"', smoke)
        self.assertIn("--tag", smoke)

    def test_restart_to_update_is_tried_on_the_same_zip_before_the_upload(self):
        # #2788. It does not hold up a release until it has passed elsewhere.
        update = self.steps[self.step_index("Update smoke test")]

        self.assertIn("scripts/smoke_update.py", update["run"])
        self.assertIn('"build/standalone/$STABLE_ZIP"', update["run"])
        self.assertLess(
            self.step_index("Smoke test"), self.step_index("Update smoke test")
        )
        self.assertLess(
            self.step_index("Update smoke test"),
            self.step_index("Attach to the release"),
        )
        self.assertEqual(
            "${{ github.event_name == 'release' }}", update["continue-on-error"]
        )

    def test_assets_are_replaced_only_on_request(self):
        attach = self.run_of("Attach to the release")

        self.assertEqual(1, self.text.count("--clobber"))
        self.assertIn(
            'if [ "$REPLACE_ASSET" = "true" ]; then\n  clobber=(--clobber)', attach
        )
        inputs = self.workflow[True]["workflow_dispatch"]["inputs"]
        self.assertEqual("boolean", inputs["replace_asset"]["type"])
        self.assertIs(False, inputs["replace_asset"]["default"])

    def test_the_asset_names_are_the_ones_the_build_writes(self):
        versioned, stable = self.build.archive_names("$VERSION", "windows-x64")

        self.assertEqual(f"{stable}.zip", self.job["env"]["STABLE_ZIP"])
        self.assertEqual(self.build.CHECKSUMS_NAME, self.job["env"]["CHECKSUMS"])
        self.assertIn(
            f"VERSIONED_ZIP={versioned}.zip", self.run_of("Resolve the version")
        )

    def test_a_tag_dispatch_builds_the_tag_or_an_explicit_ref(self):
        checkout = next(
            step
            for step in self.steps
            if step.get("uses", "").startswith("actions/checkout")
        )

        self.assertEqual(
            "${{ inputs.rebuild_from_ref || (inputs.tag && format('refs/tags/{0}', "
            "inputs.tag)) || '' }}",
            checkout["with"]["ref"],
        )
        self.assertIn(
            '"$HEAD_SHA" != "$GITHUB_SHA"', self.run_of("Check what is built")
        )

    def test_a_failed_release_build_opens_an_issue(self):
        alert = self.steps[self.step_index("Open an issue about the failure")]

        self.assertEqual("write", self.workflow["permissions"]["issues"])
        self.assertTrue(alert["if"].startswith("failure()"))
        self.assertIn("gh issue create", alert["run"])

    def test_the_release_steps_create_releases_without_latest(self):
        self.assertIn("--latest=false", RELEASE_TEMPLATE.read_text(encoding="utf-8"))


@unittest.skipUnless(
    repository_present(), "needs the repository checkout (.github/workflows)"
)
class InstallerWorkflowTest(WorkflowSteps):
    def test_the_installer_is_built_from_the_build_and_checksummed(self):
        build = self.step_index("Build")
        installer = self.step_index("Build the installer")
        self.assertLess(build, installer)
        self.assertLess(installer, self.step_index("Check the checksums"))
        self.assertIn(
            'scripts/build_installer.py --version "$VERSION" --checksums',
            self.run_of("Build the installer"),
        )

    def test_the_installer_scenarios_run_before_the_upload(self):
        smoke = self.steps[self.step_index("Installer smoke test")]
        self.assertIn(
            "scripts/smoke_installer.py build/standalone/librephotos", smoke["run"]
        )
        self.assertIn("--previous-zip", smoke["run"])
        self.assertLess(
            self.step_index("Download the latest release's zip"),
            self.step_index("Installer smoke test"),
        )
        self.assertLess(
            self.step_index("Update smoke test"),
            self.step_index("Installer smoke test"),
        )
        self.assertLess(
            self.step_index("Installer smoke test"),
            self.step_index("Attach to the release"),
        )
        self.assertEqual(
            "${{ github.event_name == 'release' }}", smoke["continue-on-error"]
        )

    def test_both_installer_names_are_attached_and_guarded(self):
        installer = load_installer_script()
        versioned, stable = installer.setup_names("$VERSION")
        self.assertEqual(stable, self.job["env"]["STABLE_SETUP"])
        self.assertIn(
            f"VERSIONED_SETUP={versioned}", self.run_of("Resolve the version")
        )
        for step in ("Attach to the release", "Check the release assets"):
            self.assertIn('"$VERSIONED_SETUP" "$STABLE_SETUP"', self.run_of(step))

    def test_signing_runs_only_with_the_secrets_and_before_the_build(self):
        signing = self.steps[self.step_index("Prepare code signing")]
        self.assertEqual("env.SIGNING_CERTIFICATE != ''", signing["if"])
        self.assertIn("WINDOWS_SIGN_ARGS=", signing["run"])
        self.assertLess(
            self.step_index("Prepare code signing"), self.step_index("Build")
        )
        self.assertEqual(
            "${{ secrets.WINDOWS_SIGNING_CERTIFICATE }}",
            self.job["env"]["SIGNING_CERTIFICATE"],
        )

    def test_a_change_to_the_installer_triggers_the_build(self):
        for event in ("pull_request", "push"):
            paths = self.workflow[True][event]["paths"]
            for path in (
                "apps/backend/installer/**",
                "apps/backend/scripts/build_installer.py",
                "apps/backend/scripts/smoke_installer.py",
                "apps/backend/librephotos/installation.py",
                "apps/backend/librephotos/move_to_installed.py",
                "apps/backend/api/updates/**",
            ):
                self.assertIn(path, paths)


def load_installer_script():
    path = BACKEND_ROOT / "scripts" / "build_installer.py"
    spec = importlib.util.spec_from_file_location("build_installer_probe", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
