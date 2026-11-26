use std::ffi::c_void;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::ptr;

use crate::orient;
use crate::pixels::{PixFmt, Pixels, fit, full_box};
use crate::request::Kind;

type CfRef = *const c_void;

const CF_NUMBER_SINT64: isize = 4;
const ALPHA_PREMULTIPLIED_LAST: u32 = 1;
const ALPHA_NONE_SKIP_LAST: u32 = 5;
const ALPHA_NONE_SKIP_FIRST: u32 = 6;
const ALPHA_NONE: u32 = 0;
const BYTE_ORDER_32_BIG: u32 = 4 << 12;

#[repr(C)]
struct CgRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    #[link_name = "kCFTypeDictionaryKeyCallBacks"]
    static DICTIONARY_KEY_CALLBACKS: u8;
    #[link_name = "kCFTypeDictionaryValueCallBacks"]
    static DICTIONARY_VALUE_CALLBACKS: u8;
    #[link_name = "kCFBooleanTrue"]
    static CF_TRUE: CfRef;
    fn CFRelease(cf: CfRef);
    fn CFURLCreateFromFileSystemRepresentation(
        allocator: CfRef,
        buffer: *const u8,
        len: isize,
        is_directory: u8,
    ) -> CfRef;
    fn CFDictionaryCreate(
        allocator: CfRef,
        keys: *const CfRef,
        values: *const CfRef,
        count: isize,
        key_callbacks: *const u8,
        value_callbacks: *const u8,
    ) -> CfRef;
    fn CFDictionaryGetValue(dict: CfRef, key: CfRef) -> CfRef;
    fn CFNumberCreate(allocator: CfRef, kind: isize, value: *const c_void) -> CfRef;
    fn CFNumberGetValue(number: CfRef, kind: isize, value: *mut c_void) -> u8;
}

#[link(name = "ImageIO", kind = "framework")]
unsafe extern "C" {
    #[link_name = "kCGImageSourceCreateThumbnailFromImageAlways"]
    static THUMBNAIL_FROM_IMAGE_ALWAYS: CfRef;
    #[link_name = "kCGImageSourceThumbnailMaxPixelSize"]
    static THUMBNAIL_MAX_PIXEL_SIZE: CfRef;
    #[link_name = "kCGImageSourceCreateThumbnailWithTransform"]
    static THUMBNAIL_WITH_TRANSFORM: CfRef;
    #[link_name = "kCGImageSourceShouldCacheImmediately"]
    static SHOULD_CACHE_IMMEDIATELY: CfRef;
    #[link_name = "kCGImagePropertyPixelWidth"]
    static PIXEL_WIDTH: CfRef;
    #[link_name = "kCGImagePropertyPixelHeight"]
    static PIXEL_HEIGHT: CfRef;
    #[link_name = "kCGImagePropertyOrientation"]
    static ORIENTATION: CfRef;
    fn CGImageSourceCreateWithURL(url: CfRef, options: CfRef) -> CfRef;
    fn CGImageSourceGetCount(source: CfRef) -> usize;
    fn CGImageSourceGetPrimaryImageIndex(source: CfRef) -> usize;
    fn CGImageSourceCopyPropertiesAtIndex(source: CfRef, index: usize, options: CfRef) -> CfRef;
    fn CGImageSourceCreateThumbnailAtIndex(source: CfRef, index: usize, options: CfRef) -> CfRef;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    #[link_name = "kCGColorSpaceSRGB"]
    static SRGB: CfRef;
    fn CGColorSpaceCreateWithName(name: CfRef) -> CfRef;
    fn CGImageGetWidth(image: CfRef) -> usize;
    fn CGImageGetHeight(image: CfRef) -> usize;
    fn CGImageGetAlphaInfo(image: CfRef) -> u32;
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits_per_component: usize,
        bytes_per_row: usize,
        space: CfRef,
        bitmap_info: u32,
    ) -> CfRef;
    fn CGContextDrawImage(context: CfRef, rect: CgRect, image: CfRef);
}

struct Owned(CfRef);

impl Owned {
    fn new(r: CfRef, what: &str) -> Result<Owned, String> {
        if r.is_null() {
            Err(format!("ImageIO: {what} failed"))
        } else {
            Ok(Owned(r))
        }
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}

fn number(value: i64) -> Result<Owned, String> {
    Owned::new(
        unsafe {
            CFNumberCreate(
                ptr::null(),
                CF_NUMBER_SINT64,
                (&raw const value).cast::<c_void>(),
            )
        },
        "CFNumberCreate",
    )
}

fn dictionary(pairs: &[(CfRef, CfRef)]) -> Result<Owned, String> {
    let keys: Vec<CfRef> = pairs.iter().map(|p| p.0).collect();
    let values: Vec<CfRef> = pairs.iter().map(|p| p.1).collect();
    Owned::new(
        unsafe {
            CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                pairs.len() as isize,
                &raw const DICTIONARY_KEY_CALLBACKS,
                &raw const DICTIONARY_VALUE_CALLBACKS,
            )
        },
        "CFDictionaryCreate",
    )
}

fn get_i64(dict: CfRef, key: CfRef) -> Option<i64> {
    let value = unsafe { CFDictionaryGetValue(dict, key) };
    if value.is_null() {
        return None;
    }
    let mut out = 0i64;
    let ok = unsafe { CFNumberGetValue(value, CF_NUMBER_SINT64, (&raw mut out).cast::<c_void>()) };
    (ok != 0).then_some(out)
}

struct Source {
    source: Owned,
    index: usize,
}

fn open(path: &Path) -> Result<Source, String> {
    let bytes = path.as_os_str().as_bytes();
    let url = Owned::new(
        unsafe {
            CFURLCreateFromFileSystemRepresentation(
                ptr::null(),
                bytes.as_ptr(),
                bytes.len() as isize,
                0,
            )
        },
        "CFURLCreateFromFileSystemRepresentation",
    )?;
    let source = Owned::new(
        unsafe { CGImageSourceCreateWithURL(url.0, ptr::null()) },
        "CGImageSourceCreateWithURL",
    )?;
    if unsafe { CGImageSourceGetCount(source.0) } == 0 {
        return Err(format!("ImageIO cannot read {}", path.display()));
    }
    let index = unsafe { CGImageSourceGetPrimaryImageIndex(source.0) };
    Ok(Source { source, index })
}

impl Source {
    fn oriented_dims(&self) -> Option<(u32, u32)> {
        let props = Owned::new(
            unsafe { CGImageSourceCopyPropertiesAtIndex(self.source.0, self.index, ptr::null()) },
            "CGImageSourceCopyPropertiesAtIndex",
        )
        .ok()?;
        let w = u32::try_from(get_i64(props.0, unsafe { PIXEL_WIDTH })?).ok()?;
        let h = u32::try_from(get_i64(props.0, unsafe { PIXEL_HEIGHT })?).ok()?;
        let o = get_i64(props.0, unsafe { ORIENTATION })
            .and_then(|o| u16::try_from(o).ok())
            .unwrap_or(1);
        (w > 0 && h > 0).then(|| orient::oriented_dims(w, h, o))
    }

    fn image(&self, max_edge: u32) -> Result<Owned, String> {
        let edge = number(i64::from(max_edge.max(1)))?;
        let options = unsafe {
            dictionary(&[
                (THUMBNAIL_FROM_IMAGE_ALWAYS, CF_TRUE),
                (THUMBNAIL_WITH_TRANSFORM, CF_TRUE),
                (SHOULD_CACHE_IMMEDIATELY, CF_TRUE),
                (THUMBNAIL_MAX_PIXEL_SIZE, edge.0),
            ])
        }?;
        Owned::new(
            unsafe { CGImageSourceCreateThumbnailAtIndex(self.source.0, self.index, options.0) },
            "CGImageSourceCreateThumbnailAtIndex",
        )
    }
}

fn opaque(alpha_info: u32) -> bool {
    matches!(
        alpha_info,
        ALPHA_NONE | ALPHA_NONE_SKIP_LAST | ALPHA_NONE_SKIP_FIRST
    )
}

pub fn unpremultiply(rgba: &mut [u8]) {
    for px in rgba.chunks_exact_mut(4) {
        let a = u32::from(px[3]);
        if a == 0 || a == 255 {
            continue;
        }
        for c in &mut px[..3] {
            *c = ((u32::from(*c) * 255 + a / 2) / a).min(255) as u8;
        }
    }
}

pub fn drop_padding(rgbx: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgbx.len() / 4 * 3);
    for px in rgbx.chunks_exact(4) {
        out.extend_from_slice(&px[..3]);
    }
    out
}

fn draw(image: &Owned) -> Result<Pixels, String> {
    let width = unsafe { CGImageGetWidth(image.0) };
    let height = unsafe { CGImageGetHeight(image.0) };
    if width == 0 || height == 0 || width > 65_000 || height > 65_000 {
        return Err(format!("ImageIO returned a {width}x{height} image"));
    }
    let has_alpha = !opaque(unsafe { CGImageGetAlphaInfo(image.0) });
    let info = if has_alpha {
        ALPHA_PREMULTIPLIED_LAST | BYTE_ORDER_32_BIG
    } else {
        ALPHA_NONE_SKIP_LAST | BYTE_ORDER_32_BIG
    };
    let mut data = vec![0u8; width * height * 4];
    let space = Owned::new(
        unsafe { CGColorSpaceCreateWithName(SRGB) },
        "CGColorSpaceCreateWithName",
    )?;
    let context = Owned::new(
        unsafe {
            CGBitmapContextCreate(
                data.as_mut_ptr().cast::<c_void>(),
                width,
                height,
                8,
                width * 4,
                space.0,
                info,
            )
        },
        "CGBitmapContextCreate",
    )?;
    let rect = CgRect {
        x: 0.0,
        y: 0.0,
        width: width as f64,
        height: height as f64,
    };
    unsafe { CGContextDrawImage(context.0, rect, image.0) };
    drop(context);
    let (width, height) = (width as u32, height as u32);
    if has_alpha {
        unpremultiply(&mut data);
        Ok(Pixels {
            width,
            height,
            format: PixFmt::Rgba8,
            data,
        })
    } else {
        Ok(Pixels {
            width,
            height,
            format: PixFmt::Rgb8,
            data: drop_padding(&data),
        })
    }
}

pub fn oriented_dims(path: &Path) -> Option<(u32, u32)> {
    open(path).ok()?.oriented_dims()
}

pub fn render(path: &Path, kind: Kind, bw: u32, bh: u32) -> Result<Pixels, String> {
    let source = open(path)?;
    let (w, h) = source
        .oriented_dims()
        .ok_or_else(|| format!("ImageIO found no size in {}", path.display()))?;
    let (bw, bh) = if kind == Kind::Full {
        full_box(w, h)
    } else {
        (bw, bh)
    };
    let (tw, th) = fit(w, h, bw, bh);
    let image = source.image(tw.max(th))?;
    draw(&image)?.fit_into(bw, bh)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lpview-imageio-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn red_on_blue_png(path: &Path) {
        let mut img = image::RgbImage::from_pixel(400, 200, image::Rgb([0, 0, 255]));
        for x in 0..200 {
            for y in 0..200 {
                img.put_pixel(x, y, image::Rgb([255, 0, 0]));
            }
        }
        img.save(path).unwrap();
    }

    #[test]
    fn decodes_and_fits_into_the_box() {
        let dir = scratch("png");
        let png = dir.join("a.png");
        red_on_blue_png(&png);
        assert_eq!(oriented_dims(&png), Some((400, 200)));
        let px = render(&png, Kind::Screen, 200, 200).unwrap();
        assert_eq!((px.width, px.height, px.format), (200, 100, PixFmt::Rgb8));
        let left = &px.data[(50 * 200 + 20) * 3..][..3];
        let right = &px.data[(50 * 200 + 180) * 3..][..3];
        assert!(left[0] > 200 && left[2] < 60, "left half is red: {left:?}");
        assert!(
            right[2] > 200 && right[0] < 60,
            "right half is blue: {right:?}"
        );
        let full = render(&png, Kind::Full, 0, 0).unwrap();
        assert_eq!((full.width, full.height), (400, 200));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn decodes_a_heic_written_by_sips() {
        let dir = scratch("heic");
        let png = dir.join("a.png");
        let heic = dir.join("a.heic");
        red_on_blue_png(&png);
        let made = std::process::Command::new("sips")
            .args(["-s", "format", "heic"])
            .arg(&png)
            .arg("--out")
            .arg(&heic)
            .output()
            .unwrap();
        assert!(
            made.status.success() && heic.is_file(),
            "sips wrote no HEIC: {}",
            String::from_utf8_lossy(&made.stderr)
        );
        assert_eq!(oriented_dims(&heic), Some((400, 200)));
        let px = render(&heic, Kind::Thumb, 320, 320).unwrap();
        assert_eq!((px.width, px.height), (320, 160));
        let left = &px.data[(80 * 320 + 40) * 3..][..3];
        assert!(left[0] > 180 && left[2] < 90, "left half is red: {left:?}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_what_it_cannot_read() {
        let dir = scratch("bad");
        let bad = dir.join("bad.heic");
        std::fs::write(&bad, b"not an image").unwrap();
        assert!(render(&bad, Kind::Screen, 100, 100).is_err());
        assert_eq!(oriented_dims(&dir.join("missing.heic")), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unpremultiplies_and_drops_padding() {
        let mut px = [100, 50, 0, 128, 10, 20, 30, 255, 0, 0, 0, 0];
        unpremultiply(&mut px);
        assert_eq!(px, [199, 100, 0, 128, 10, 20, 30, 255, 0, 0, 0, 0]);
        assert_eq!(drop_padding(&[1, 2, 3, 0, 4, 5, 6, 0]), [1, 2, 3, 4, 5, 6]);
    }
}
