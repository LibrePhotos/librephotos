import os
import uuid
from unittest.mock import MagicMock, patch

from django.test import TestCase  # type: ignore

from api.directory_watcher import handle_new_image
from api.models import LongRunningJob, User


class ScanPercentageProgressTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser",
            password="testpass",
        )
        self.user.skip_raw_files = True
        self.user.save()
        self.job_id = uuid.uuid4()

    def _scan_file_list(self):
        return (
            [f"photo{i}.jpg" for i in range(10)]
            + [f"photo{i}.raw" for i in range(7)]
            + [f"photo{i}.xmp" for i in range(10)]
            + [f"document{i}.pdf" for i in range(10)]
        )

    def _simulate_pre_fix_progress(self, files):
        images_and_videos: list[str] = []
        metadata_paths: list[str] = []
        for path in files:
            if path.endswith(".xmp"):
                metadata_paths.append(path)
            else:
                images_and_videos.append(path)

        processed = 0
        for path in images_and_videos:
            ext = os.path.splitext(path)[1].lower()
            if ext == ".raw" and self.user.skip_raw_files:
                continue
            if ext == ".pdf":
                continue
            if ext == ".jpg":
                processed += 1
        processed += len(metadata_paths)
        return processed

    def test_scan_progress_counts_every_discovered_file(self):
        """Ensure the scan job reaches 100% even when files are skipped or metadata."""

        files = self._scan_file_list()
        pre_fix_processed = self._simulate_pre_fix_progress(files)
        pre_fix_percentage = (pre_fix_processed / len(files)) * 100
        pre_fix_summary = (
            f"Pre-fix simulated progress: {pre_fix_processed}/{len(files)} "
            f"({pre_fix_percentage:.1f}%) -> stuck"
        )
        discovered_by_ext: dict[str, int] = {}
        for path in files:
            ext = os.path.splitext(path)[1].lower()
            discovered_by_ext[ext] = discovered_by_ext.get(ext, 0) + 1
        lrj = LongRunningJob.objects.create(
            started_by=self.user,
            job_id=self.job_id,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            progress_current=0,
            progress_target=len(files),
        )

        photos_created_by_ext: dict[str, int] = {}

        def mock_create_new_image(user, path):
            ext = os.path.splitext(path)[1].lower()
            if ext == ".jpg":
                photos_created_by_ext[ext] = photos_created_by_ext.get(ext, 0) + 1
                return MagicMock()
            photos_created_by_ext[ext] = photos_created_by_ext.get(ext, 0)
            return None

        thumbnail_mock = MagicMock()
        thumbnail_mock._generate_thumbnail.return_value = None
        thumbnail_mock._calculate_aspect_ratio.return_value = None
        thumbnail_mock._get_dominant_color.return_value = None
        search_instance_mock = MagicMock()

        with patch(
            "api.directory_watcher.create_new_image",
            side_effect=mock_create_new_image,
        ), patch(
            "api.models.Thumbnail.objects.get_or_create",
            return_value=(thumbnail_mock, True),
        ), patch(
            "api.models.PhotoSearch.objects.get_or_create",
            return_value=(search_instance_mock, True),
        ):
            for path in files:
                handle_new_image(self.user, path, self.job_id)

        lrj.refresh_from_db()
        percentage = (
            (lrj.progress_current / lrj.progress_target) * 100
            if lrj.progress_target
            else 0
        )
        file_breakdown = ["File breakdown:" ]
        for ext, total in sorted(discovered_by_ext.items()):
            created = photos_created_by_ext.get(ext, 0)
            behavior = "creates Photo" if created else "skipped"
            file_breakdown.append(
                f" - {ext}: discovered={total}, create_new_image={behavior}"
            )
        breakdown_summary = "\n".join(file_breakdown)
        progress_summary = (
            f"Scan job progress: {lrj.progress_current}/{lrj.progress_target} "
            f"({percentage:.1f}%) finished={lrj.finished}"
        )
        print(pre_fix_summary)
        print(breakdown_summary)
        print(progress_summary)

        self.assertLess(
            pre_fix_processed,
            len(files),
            "Pre-fix simulation should demonstrate the bug (progress < total).",
        )
        self.assertEqual(lrj.progress_target, len(files), progress_summary)
        self.assertEqual(
            lrj.progress_current,
            len(files),
            f"{breakdown_summary}\n{progress_summary} -> Every discovered file should advance the counter.",
        )
        self.assertTrue(
            lrj.finished,
            f"{breakdown_summary}\n{progress_summary} -> Scan job must finish when current equals target.",
        )
