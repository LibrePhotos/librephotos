//! `api/color_palettes.py::hex_palette`.

const PAIRED: [&str; 12] = [
    "#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00",
    "#cab2d6", "#6a3d9a", "#ffff99", "#b15928",
];

/// `hex_palette("paired", n)`: the Paired colors, cycled.
pub fn paired(n: usize) -> Vec<String> {
    (0..n)
        .map(|i| PAIRED[i % PAIRED.len()].to_string())
        .collect()
}

/// `hex_palette("hls", n)`: evenly spaced hues, lightness 0.6, saturation 0.65.
pub fn hls(n: usize) -> Vec<String> {
    (0..n)
        .map(|i| {
            let (r, g, b) = hls_to_rgb(i as f64 / n as f64, 0.6, 0.65);
            format!(
                "#{:02x}{:02x}{:02x}",
                (r * 255.0) as u8,
                (g * 255.0) as u8,
                (b * 255.0) as u8
            )
        })
        .collect()
}

/// Python's `colorsys.hls_to_rgb`.
fn hls_to_rgb(h: f64, l: f64, s: f64) -> (f64, f64, f64) {
    if s == 0.0 {
        return (l, l, l);
    }
    let m2 = if l <= 0.5 {
        l * (1.0 + s)
    } else {
        l + s - (l * s)
    };
    let m1 = 2.0 * l - m2;
    (
        hls_value(m1, m2, h + 1.0 / 3.0),
        hls_value(m1, m2, h),
        hls_value(m1, m2, h - 1.0 / 3.0),
    )
}

fn hls_value(m1: f64, m2: f64, hue: f64) -> f64 {
    let hue = hue.rem_euclid(1.0);
    if hue < 1.0 / 6.0 {
        m1 + (m2 - m1) * hue * 6.0
    } else if hue < 0.5 {
        m2
    } else if hue < 2.0 / 3.0 {
        m1 + (m2 - m1) * (2.0 / 3.0 - hue) * 6.0
    } else {
        m1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `hex_palette("hls", 10)` from Python.
    #[test]
    fn hls_matches_python() {
        assert_eq!(
            hls(10),
            [
                "#db5656", "#dba656", "#c0db56", "#71db56", "#56db8b", "#56dbdb", "#568bdb",
                "#7156db", "#c056db", "#db56a6"
            ]
        );
        assert_eq!(paired(13)[12], "#a6cee3");
    }
}
