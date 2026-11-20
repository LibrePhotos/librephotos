use fast_image_resize as fr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixFmt {
    Rgb8,
    Bgr8,
    Rgba8,
    Bgrx8,
}

impl PixFmt {
    pub fn bytes_per_pixel(self) -> usize {
        match self {
            PixFmt::Rgb8 | PixFmt::Bgr8 => 3,
            PixFmt::Rgba8 | PixFmt::Bgrx8 => 4,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Pixels {
    pub width: u32,
    pub height: u32,
    pub format: PixFmt,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
}

pub fn fit(w: u32, h: u32, bw: u32, bh: u32) -> (u32, u32) {
    if w == 0 || h == 0 || (w <= bw && h <= bh) {
        return (w, h);
    }
    let s = (bw as f64 / w as f64).min(bh as f64 / h as f64);
    (
        ((w as f64 * s).round() as u32).clamp(1, bw.max(1)),
        ((h as f64 * s).round() as u32).clamp(1, bh.max(1)),
    )
}

pub const FULL_MAX_PIXELS: u64 = 120_000_000;

pub fn full_box(w: u32, h: u32) -> (u32, u32) {
    let px = w as u64 * h as u64;
    let s = if px > FULL_MAX_PIXELS {
        (FULL_MAX_PIXELS as f64 / px as f64).sqrt()
    } else {
        1.0
    };
    let (bw, bh) = ((w as f64 * s) as u32, (h as f64 * s) as u32);
    (bw.clamp(1, 65000), bh.clamp(1, 65000))
}

impl Pixels {
    pub fn has_alpha(&self) -> bool {
        self.format == PixFmt::Rgba8
    }

    pub fn uses_alpha(&self) -> bool {
        self.has_alpha() && self.data.as_chunks::<4>().0.iter().any(|p| p[3] != 255)
    }

    pub fn resize(self, tw: u32, th: u32) -> Result<Pixels, String> {
        if (tw, th) == (self.width, self.height) || tw == 0 || th == 0 {
            return Ok(self);
        }
        let pt = if self.format.bytes_per_pixel() == 3 {
            fr::PixelType::U8x3
        } else {
            fr::PixelType::U8x4
        };
        let src = fr::images::Image::from_vec_u8(self.width, self.height, self.data, pt)
            .map_err(|e| e.to_string())?;
        let mut dst = fr::images::Image::new(tw, th, pt);
        let opts = fr::ResizeOptions::new()
            .resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Bilinear))
            .use_alpha(self.format == PixFmt::Rgba8);
        fr::Resizer::new()
            .resize(&src, &mut dst, &opts)
            .map_err(|e| e.to_string())?;
        Ok(Pixels {
            width: tw,
            height: th,
            format: self.format,
            data: dst.into_vec(),
        })
    }

    pub fn fit_into(self, bw: u32, bh: u32) -> Result<Pixels, String> {
        let (tw, th) = fit(self.width, self.height, bw, bh);
        self.resize(tw, th)
    }

    pub fn into_rgba(self) -> Vec<u8> {
        match self.format {
            PixFmt::Rgba8 => self.data,
            PixFmt::Rgb8 => self
                .data
                .as_chunks::<3>()
                .0
                .iter()
                .flat_map(|p| [p[0], p[1], p[2], 255])
                .collect(),
            PixFmt::Bgr8 => self
                .data
                .as_chunks::<3>()
                .0
                .iter()
                .flat_map(|p| [p[2], p[1], p[0], 255])
                .collect(),
            PixFmt::Bgrx8 => self
                .data
                .as_chunks::<4>()
                .0
                .iter()
                .flat_map(|p| [p[2], p[1], p[0], 255])
                .collect(),
        }
    }

    pub fn encode(&self) -> Result<Encoded, String> {
        if self.uses_alpha() {
            return self.encode_png();
        }
        self.encode_jpeg(90)
    }

    pub fn encode_jpeg(&self, quality: u8) -> Result<Encoded, String> {
        #[cfg(windows)]
        if let Ok(bytes) = crate::decode::wic::encode_jpeg(self, quality as f32 / 100.0) {
            return Ok(Encoded {
                bytes,
                mime: "image/jpeg",
                width: self.width,
                height: self.height,
            });
        }
        self.encode_jpeg_rust(quality)
    }

    pub fn encode_jpeg_rust(&self, quality: u8) -> Result<Encoded, String> {
        if self.width > 65535 || self.height > 65535 {
            return Err("image too large for JPEG".into());
        }
        let ct = match self.format {
            PixFmt::Rgb8 => jpeg_encoder::ColorType::Rgb,
            PixFmt::Bgr8 => jpeg_encoder::ColorType::Bgr,
            PixFmt::Rgba8 => jpeg_encoder::ColorType::Rgba,
            PixFmt::Bgrx8 => jpeg_encoder::ColorType::Bgra,
        };
        let mut out = Vec::with_capacity(self.data.len() / 8 + 4096);
        let mut enc = jpeg_encoder::Encoder::new(&mut out, quality);
        enc.set_sampling_factor(jpeg_encoder::SamplingFactor::R_4_2_0);
        enc.encode(&self.data, self.width as u16, self.height as u16, ct)
            .map_err(|e| e.to_string())?;
        Ok(Encoded {
            bytes: out,
            mime: "image/jpeg",
            width: self.width,
            height: self.height,
        })
    }

    pub fn encode_png(&self) -> Result<Encoded, String> {
        let mut out = Vec::with_capacity(self.data.len() / 2);
        {
            let mut enc = png::Encoder::new(&mut out, self.width, self.height);
            enc.set_color(if self.has_alpha() {
                png::ColorType::Rgba
            } else {
                png::ColorType::Rgb
            });
            enc.set_depth(png::BitDepth::Eight);
            enc.set_compression(png::Compression::Fast);
            let mut w = enc.write_header().map_err(|e| e.to_string())?;
            let data: std::borrow::Cow<[u8]> = match self.format {
                PixFmt::Rgb8 | PixFmt::Rgba8 => self.data.as_slice().into(),
                PixFmt::Bgr8 => self
                    .data
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .flat_map(|p| [p[2], p[1], p[0]])
                    .collect::<Vec<_>>()
                    .into(),
                PixFmt::Bgrx8 => return Err("BGRX has no alpha".into()),
            };
            w.write_image_data(&data).map_err(|e| e.to_string())?;
        }
        Ok(Encoded {
            bytes: out,
            mime: "image/png",
            width: self.width,
            height: self.height,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_never_upscales() {
        assert_eq!(fit(6000, 4000, 2560, 1440), (2160, 1440));
        assert_eq!(fit(4000, 6000, 2560, 1440), (960, 1440));
        assert_eq!(fit(800, 600, 2560, 1440), (800, 600));
        assert_eq!(fit(12000, 100, 320, 320), (320, 3));
        assert_eq!(fit(1, 100000, 320, 320), (1, 320));
    }

    #[test]
    fn full_box_caps_huge_images() {
        assert_eq!(full_box(6000, 4000), (6000, 4000));
        let (w, h) = full_box(21000, 14200);
        assert!((w as u64 * h as u64) <= FULL_MAX_PIXELS);
        assert!(w > 13000);
    }

    #[test]
    fn encodes_jpeg_and_png() {
        let rgb = Pixels {
            width: 64,
            height: 32,
            format: PixFmt::Rgb8,
            data: vec![128; 64 * 32 * 3],
        };
        let e = rgb.encode().unwrap();
        assert_eq!(e.mime, "image/jpeg");
        assert_eq!(&e.bytes[..2], &[0xFF, 0xD8]);
        let mut rgba = Pixels {
            width: 8,
            height: 8,
            format: PixFmt::Rgba8,
            data: vec![255; 256],
        };
        assert_eq!(
            rgba.encode().unwrap().mime,
            "image/jpeg",
            "opaque RGBA is a JPEG"
        );
        rgba.data[3] = 0;
        let e = rgba.encode().unwrap();
        assert_eq!(e.mime, "image/png");
        assert_eq!(&e.bytes[1..4], b"PNG");
    }

    #[test]
    fn resizes() {
        let p = Pixels {
            width: 100,
            height: 50,
            format: PixFmt::Bgr8,
            data: vec![7; 100 * 50 * 3],
        };
        let r = p.fit_into(20, 20).unwrap();
        assert_eq!((r.width, r.height, r.data.len()), (20, 10, 20 * 10 * 3));
        assert!(r.data.iter().all(|&v| v == 7));
    }
}
