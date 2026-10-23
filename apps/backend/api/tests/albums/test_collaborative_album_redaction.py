"""The "both must allow" grant algebra of collaborative albums (#464).

The field tables and the redaction are the library share's
(``api/sharing/grants.py``), with their own guard test; here only how an
album's ceiling and a photo owner's choice combine.
"""

from django.test import SimpleTestCase

from api.albums.member_grants import NOTHING, both, either
from api.sharing.grants import LibraryGrant


class GrantAlgebraTest(SimpleTestCase):
    def test_both_must_allow_and_any_album_may_show(self):
        album = LibraryGrant(location=True, camera=True)
        member = LibraryGrant(location=True, people=True)
        self.assertEqual(both(album, member), LibraryGrant(location=True))
        self.assertEqual(
            either(album, member), LibraryGrant(True, True, True, False, False)
        )
        self.assertEqual(both(album, NOTHING), NOTHING)
        self.assertEqual(either(NOTHING, NOTHING), NOTHING)
