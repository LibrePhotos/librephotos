from colorsys import hls_to_rgb

DEEP_PALETTE = [
    "#4c72b0",
    "#dd8452",
    "#55a868",
    "#c44e52",
    "#8172b3",
    "#937860",
    "#da8bc3",
    "#8c8c8c",
    "#ccb974",
    "#64b5cd",
]

PAIRED_PALETTE = [
    "#a6cee3",
    "#1f78b4",
    "#b2df8a",
    "#33a02c",
    "#fb9a99",
    "#e31a1c",
    "#fdbf6f",
    "#ff7f00",
    "#cab2d6",
    "#6a3d9a",
    "#ffff99",
    "#b15928",
]


def _rgb_to_hex(rgb: tuple[float, float, float]) -> str:
    return "#" + "".join(f"{int(round(channel * 255)):02x}" for channel in rgb)


def _cycled_palette(base_palette: list[str], n_colors: int) -> list[str]:
    if n_colors <= 0:
        return []
    return [base_palette[idx % len(base_palette)] for idx in range(n_colors)]


def _hls_palette(
    n_colors: int, lightness: float = 0.6, saturation: float = 0.65
) -> list[str]:
    if n_colors <= 0:
        return []
    return [
        _rgb_to_hex(hls_to_rgb(idx / n_colors, lightness, saturation))
        for idx in range(n_colors)
    ]


def hex_palette(name: str | None = None, n_colors: int = 6) -> list[str]:
    palette_name = (name or "deep").lower()
    if palette_name == "deep":
        return _cycled_palette(DEEP_PALETTE, n_colors)
    if palette_name == "hls":
        return _hls_palette(n_colors)
    if palette_name == "paired":
        return _cycled_palette(PAIRED_PALETTE, n_colors)
    raise ValueError(f"Unsupported palette: {name}")
