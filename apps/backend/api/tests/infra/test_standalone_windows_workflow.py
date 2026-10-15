"""The release path of .github/workflows/standalone-windows.yml (#2318, #2319, #2317).

A full run takes about three hours, so the workflow is only exercised on a
release. These guards keep the promises it makes to the download link: the
release becomes Latest only after the smoke test and the upload, nothing is
overwritten silently, and the asset names are the ones build_standalone.py writes.
"""

import unittest

import yaml
from django.test import SimpleTestCase

from api.tests.infra.deploy_files import REPO_ROOT, WORKFLOWS_DIR, repository_present
from api.tests.infra.test_standalone import load_build_script

WORKFLOW = WORKFLOWS_DIR / "standalone-windows.yml"
RELEASE_TEMPLATE = REPO_ROOT / ".github" / "release-notes-template.md"


@unittest.skipUnless(
    repository_present(), "needs the repository checkout (.github/workflows)"
)
class StandaloneWindowsWorkflowTest(SimpleTestCase):
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
