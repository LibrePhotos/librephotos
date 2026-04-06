import unittest

from api.color_palettes import DEEP_PALETTE, PAIRED_PALETTE, hex_palette


class HexPaletteTests(unittest.TestCase):
    def test_deep_palette_cycles(self):
        self.assertEqual(hex_palette(n_colors=0), [])
        self.assertEqual(hex_palette(n_colors=3), DEEP_PALETTE[:3])
        self.assertEqual(hex_palette(n_colors=12), DEEP_PALETTE + DEEP_PALETTE[:2])

    def test_hls_palette_returns_hex_colors(self):
        palette = hex_palette("hls", 5)

        self.assertEqual(len(palette), 5)
        self.assertEqual(len(set(palette)), 5)
        for color in palette:
            self.assertRegex(color, r"^#[0-9a-f]{6}$")

    def test_paired_palette_cycles(self):
        self.assertEqual(hex_palette("Paired", 2), PAIRED_PALETTE[:2])
        self.assertEqual(
            hex_palette("Paired", 14),
            PAIRED_PALETTE + PAIRED_PALETTE[:2],
        )

    def test_unsupported_palette_raises(self):
        with self.assertRaises(ValueError):
            hex_palette("unknown", 1)
