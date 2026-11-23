use std::path::Path;
use std::sync::Arc;

use crate::formats::{FileKind, ext_of, kind_of_ext};
use crate::pixels::{PixFmt, Pixels};
use crate::request::Kind;

pub trait RowSource: Send {
    fn rows(&mut self, scale: u32, y0: u32, y1: u32) -> Result<Pixels, String>;
}

pub type Opener = Box<dyn Fn() -> Result<Box<dyn RowSource>, String> + Send + Sync>;

pub struct Opened {
    pub width: u32,
    pub height: u32,
    pub orientation: u16,
    pub max_scale: u32,
    pub has_alpha: bool,
    pub open: Opener,
}

pub fn probe_dims(path: &Path) -> Option<(u32, u32)> {
    let ext = ext_of(path);
    match kind_of_ext(&ext)? {
        FileKind::Video => None,
        FileKind::Raw => {
            let md = crate::decode::raw::metadata(path).ok()?;
            Some(crate::orient::oriented_dims(
                md.width,
                md.height,
                md.orientation as u16,
            ))
        }
        FileKind::Image => {
            if crate::formats::is_jpeg(&ext)
                && let Some(h) = crate::jpegmeta::read_head(path)
                    .ok()
                    .and_then(|b| crate::jpegmeta::parse_head(&b))
                && h.width > 0
            {
                return Some(crate::orient::oriented_dims(
                    h.width,
                    h.height,
                    h.orientation,
                ));
            }
            #[cfg(windows)]
            if let Ok(s) = crate::decode::wic::open_file(path) {
                return Some(s.oriented_dims());
            }
            image::image_dimensions(path).ok()
        }
    }
}

pub fn open(path: &Path) -> Result<Opened, String> {
    let ext = ext_of(path);
    match kind_of_ext(&ext) {
        None | Some(FileKind::Video) => Err(format!("'.{ext}' has no tiles")),
        Some(FileKind::Raw) => {
            match crate::decode::raw::render(path, Kind::Full, u32::MAX, u32::MAX)? {
                crate::decode::Rendered::Pixels(p) => Ok(memory(p)),
                _ => Err("RAW develop returned no pixels".into()),
            }
        }
        Some(FileKind::Image) => {
            if ext == "gif" {
                return Err("GIFs are not tiled".into());
            }
            #[cfg(windows)]
            match wic::open(path) {
                Ok(o) => return Ok(o),
                Err(e) if crate::formats::is_jpeg(&ext) => return Err(e),
                Err(_) => {}
            }
            let p = crate::decode::generic::render(path, Kind::Full, u32::MAX, u32::MAX)?;
            Ok(memory(p))
        }
    }
}

pub fn memory(p: Pixels) -> Opened {
    let has_alpha = p.uses_alpha();
    let p = if p.format.bytes_per_pixel() == 4 && !has_alpha {
        let format = if p.format == PixFmt::Bgrx8 {
            PixFmt::Bgr8
        } else {
            PixFmt::Rgb8
        };
        let data = p
            .data
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|c| [c[0], c[1], c[2]])
            .collect();
        Pixels {
            width: p.width,
            height: p.height,
            format,
            data,
        }
    } else {
        p
    };
    let (width, height) = (p.width, p.height);
    let p = Arc::new(p);
    Opened {
        width,
        height,
        orientation: 1,
        max_scale: 0,
        has_alpha,
        open: Box::new(move || Ok(Box::new(MemRows(p.clone())) as Box<dyn RowSource>)),
    }
}

struct MemRows(Arc<Pixels>);

impl RowSource for MemRows {
    fn rows(&mut self, _scale: u32, y0: u32, y1: u32) -> Result<Pixels, String> {
        let p = &self.0;
        let row = p.width as usize * p.format.bytes_per_pixel();
        let y1 = y1.min(p.height);
        Ok(Pixels {
            width: p.width,
            height: y1.saturating_sub(y0),
            format: p.format,
            data: p.data[y0 as usize * row..y1 as usize * row].to_vec(),
        })
    }
}

#[cfg(windows)]
mod wic {
    use std::path::{Path, PathBuf};

    use windows::Win32::Graphics::Imaging::*;
    use windows::core::Interface;

    use super::{Opened, RowSource};
    use crate::decode::wic::{self as w, Source};
    use crate::pixels::{PixFmt, Pixels};

    fn err(e: windows::core::Error) -> String {
        format!("WIC: {} ({:#010x})", e.message(), e.code().0)
    }

    pub fn open(path: &Path) -> Result<Opened, String> {
        let src = w::open_file(path)?;
        let fac = w::factory()?;
        let native = unsafe { src.frame.GetPixelFormat().map_err(err)? };
        let has_alpha = unsafe {
            fac.CreateComponentInfo(&native)
                .and_then(|i| i.cast::<IWICPixelFormatInfo2>())
                .and_then(|i| i.SupportsTransparency())
                .map(|b| b.as_bool())
                .unwrap_or(false)
        };
        let max_scale = native_scales(&src);
        let path: PathBuf = path.to_path_buf();
        Ok(Opened {
            width: src.width,
            height: src.height,
            orientation: src.orientation,
            max_scale,
            has_alpha,
            open: Box::new(move || {
                let src = w::open_file(&path)?;
                Ok(Box::new(WicRows::new(src)?) as Box<dyn RowSource>)
            }),
        })
    }

    fn native_scales(src: &Source) -> u32 {
        unsafe {
            if src.frame.GetPixelFormat().ok() != Some(GUID_WICPixelFormat24bppBGR) {
                return 0;
            }
            let Ok(t) = src.frame.cast::<IWICBitmapSourceTransform>() else {
                return 0;
            };
            let mut best = 0;
            for s in 1..=3u32 {
                let want = (src.width.div_ceil(1 << s), src.height.div_ceil(1 << s));
                let (mut cw, mut ch) = want;
                if t.GetClosestSize(&mut cw, &mut ch).is_err() || (cw, ch) != want {
                    break;
                }
                let mut fmt = GUID_WICPixelFormat24bppBGR;
                if t.GetClosestPixelFormat(&mut fmt).is_err() || fmt != GUID_WICPixelFormat24bppBGR
                {
                    break;
                }
                best = s;
            }
            best
        }
    }

    struct WicRows {
        src: Source,
        bgr: IWICBitmapSource,
        transform: Option<IWICBitmapSourceTransform>,
    }

    unsafe impl Send for WicRows {}

    impl WicRows {
        fn new(src: Source) -> Result<WicRows, String> {
            let fac = w::factory()?;
            unsafe {
                let frame: IWICBitmapSource = src.frame.cast().map_err(err)?;
                let bgr = if frame.GetPixelFormat().map_err(err)? == GUID_WICPixelFormat24bppBGR {
                    frame
                } else {
                    let c = fac.CreateFormatConverter().map_err(err)?;
                    c.Initialize(
                        &frame,
                        &GUID_WICPixelFormat24bppBGR,
                        WICBitmapDitherTypeNone,
                        None::<&IWICPalette>,
                        0.0,
                        WICBitmapPaletteTypeCustom,
                    )
                    .map_err(err)?;
                    c.cast().map_err(err)?
                };
                let transform = src.frame.cast::<IWICBitmapSourceTransform>().ok();
                Ok(WicRows {
                    src,
                    bgr,
                    transform,
                })
            }
        }
    }

    impl WicRows {
        unsafe fn copy(
            &self,
            scale: u32,
            rect: &WICRect,
            stride: u32,
            buf: &mut [u8],
        ) -> Result<(), String> {
            unsafe {
                if scale == 0 {
                    return self.bgr.CopyPixels(rect, stride, buf).map_err(err);
                }
                let t = self
                    .transform
                    .as_ref()
                    .ok_or("no native scaling for this image")?;
                t.CopyPixels(
                    rect,
                    self.src.width.div_ceil(1 << scale),
                    self.src.height.div_ceil(1 << scale),
                    &GUID_WICPixelFormat24bppBGR,
                    WICBitmapTransformRotate0,
                    stride,
                    buf,
                )
                .map_err(err)
            }
        }
    }

    impl RowSource for WicRows {
        fn rows(&mut self, scale: u32, y0: u32, y1: u32) -> Result<Pixels, String> {
            let (w, h) = (
                self.src.width.div_ceil(1 << scale),
                self.src.height.div_ceil(1 << scale),
            );
            let y1 = y1.min(h);
            let n = y1.saturating_sub(y0);
            let stride = (w * 3).next_multiple_of(4);
            let mut buf = vec![0u8; stride as usize * n as usize];
            let rect = WICRect {
                X: 0,
                Y: y0 as i32,
                Width: w as i32,
                Height: n as i32,
            };
            unsafe { self.copy(scale, &rect, stride, &mut buf)? };
            let row = w * 3;
            let data = if row == stride {
                buf
            } else {
                buf.chunks_exact(stride as usize)
                    .flat_map(|r| r[..row as usize].iter().copied())
                    .collect()
            };
            Ok(Pixels {
                width: w,
                height: n,
                format: PixFmt::Bgr8,
                data,
            })
        }
    }
}
