"""Names and folders made from a photo's capture date (#2773, #2774)."""

import datetime

from django.test import SimpleTestCase

from api.models import File, Photo
from api.photos.naming import (
    InvalidPatternError,
    capture_wall_clock,
    check_folder_pattern,
    check_name_pattern,
    render_folder,
    render_name,
    uses_date,
)

TAKEN = datetime.datetime(2025, 6, 1, 23, 30, 5, tzinfo=datetime.UTC)


def photo(
    path: str = "/photos/a/IMG_4711.jpg",
    taken: datetime.datetime | None = TAKEN,
    with_file: bool = True,
) -> Photo:
    """An unsaved photo: render_* only read its date and main file."""
    return Photo(exif_timestamp=taken, main_file=File(path=path) if with_file else None)


class CheckNamePatternTest(SimpleTestCase):
    def test_the_presets_pass(self) -> None:
        for pattern in (
            "{year}{month}{day}_{hour}{minute}{second}",
            "{year}-{month}-{day} {hour}.{minute}.{second} {name}",
            "{year}{month}{day}_{name}",
            "holiday",
        ):
            with self.subTest(pattern=pattern):
                check_name_pattern(pattern)

    def test_unsafe_patterns_are_refused(self) -> None:
        for pattern in (
            "",
            "   ",
            "../x",
            "a/b",
            "a\\b",
            "con:",
            "..",
            ".hidden",
            "a*b",
            'a"b',
            "a<b>",
            "a|b",
            "a?",
            "tab\there",
            "{nope}",
            "{year",
            "year}",
            "{YEAR}",
            "x" * 201,
        ):
            with self.subTest(pattern=pattern), self.assertRaises(InvalidPatternError):
                check_name_pattern(pattern)


class CheckFolderPatternTest(SimpleTestCase):
    def test_the_presets_pass(self) -> None:
        for pattern in ("{year}", "{year}/{month}", "{year}/{month}/{day}"):
            with self.subTest(pattern=pattern):
                check_folder_pattern(pattern)

    def test_unsafe_patterns_are_refused(self) -> None:
        for pattern in (
            "/{year}",
            "{year}/",
            "{year}//{month}",
            "../{year}",
            "{year}/..",
            "{year}\\{month}",
            "C:/{year}",
            "{year}/.thumbs",
            "{name}",
            "a/b/c/d/e/f/g",
        ):
            with self.subTest(pattern=pattern), self.assertRaises(InvalidPatternError):
                check_folder_pattern(pattern)


class RenderTest(SimpleTestCase):
    def test_the_tokens(self) -> None:
        self.assertEqual(
            "20250601_233005",
            render_name("{year}{month}{day}_{hour}{minute}{second}", photo()),
        )
        self.assertEqual(
            "2025-06 IMG_4711", render_name("{year}-{month} {name}", photo())
        )

    def test_the_wall_clock_is_read_as_stored(self) -> None:
        # Stored as the wall clock tagged UTC: no time zone shift.
        self.assertEqual(
            datetime.datetime(2025, 6, 1, 23, 30, 5), capture_wall_clock(photo())
        )
        naive = photo(taken=datetime.datetime(2025, 6, 1, 23, 30, 5))
        self.assertEqual("23", render_name("{hour}", naive))

    def test_an_undated_photo(self) -> None:
        undated = photo(taken=None)
        self.assertIsNone(render_name("{year}_{name}", undated))
        self.assertIsNone(render_folder("{year}", undated))
        # A pattern without a date token does not need one.
        self.assertEqual("x_IMG_4711", render_name("x_{name}", undated))

    def test_a_photo_without_a_main_file(self) -> None:
        self.assertEqual("2025_", render_name("{year}_{name}", photo(with_file=False)))

    def test_the_name_is_made_safe(self) -> None:
        # A POSIX file name may hold characters Windows refuses.
        self.assertEqual(
            "2025_a_b_c", render_name("{year}_{name}", photo("/p/a:b*c.jpg"))
        )
        self.assertEqual("_", render_name("{name}", photo("/p/....")))
        self.assertEqual("_CON", render_name("{name}", photo("/p/CON.jpg")))
        self.assertEqual("_aux.x", render_name("{name}", photo("/p/aux.x.jpg")))
        self.assertEqual("a", render_name("{name}", photo("/p/a. .jpg")))
        self.assertEqual("x", render_name("{name}", photo("/p/..x.jpg")))

    def test_a_long_name_is_cut(self) -> None:
        name = render_name("{name}", photo("/p/" + "a" * 300 + ".jpg"))
        assert name is not None
        self.assertEqual(180, len(name))

    def test_folders(self) -> None:
        self.assertEqual(
            ["2025", "06", "01"], render_folder("{year}/{month}/{day}", photo())
        )
        self.assertEqual(["2025-06"], render_folder("{year}-{month}", photo()))

    def test_uses_date(self) -> None:
        self.assertTrue(uses_date("{day}"))
        self.assertFalse(uses_date("{name} x"))
