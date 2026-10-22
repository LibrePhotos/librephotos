"""An upload's import chain ends by requesting the user's follow-ups (#2735).

The request is the chain's last task, so the follow-up run sees the photo with
its tags and faces done; repeated requests coalesce into one run per user
(``api/tests/jobs/test_upload_followups.py``).
"""

from api.jobs.upload_followups import request_upload_followups
from api.tests.uploads.test_upload_into_album import UploadIntoAlbumTestBase


class UploadRequestsFollowupsTest(UploadIntoAlbumTestBase):
    def test_the_follow_ups_are_requested_last(self):
        response = self.complete(self.stage())

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            (request_upload_followups, (self.user,)), self.queued_tasks()[-1]
        )

    def test_a_duplicate_requests_nothing(self):
        self.complete(self.stage())
        self.chain.reset_mock()

        self.complete(self.stage())

        self.chain.assert_not_called()
