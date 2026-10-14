//! libvips loaded at runtime (`LP_VIPS_LIB`) with `libloading`: the calls
//! `api/thumbnails.py` makes through pyvips, with the same options.
//! Everything returns `Err(message)` with libvips' error buffer.

#![allow(unsafe_code)]

use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::path::Path;
use std::ptr;
use std::sync::OnceLock;

use libloading::Library;

#[repr(C)]
pub struct VipsImage {
    _private: [u8; 0],
}

pub const SIZE_DOWN: c_int = 2;
pub const ANGLE_D90: c_int = 1;
pub const ANGLE_D180: c_int = 2;
pub const ANGLE_D270: c_int = 3;
pub const DIRECTION_HORIZONTAL: c_int = 0;
pub const DIRECTION_VERTICAL: c_int = 1;

type FnInit = unsafe extern "C" fn(*const c_char) -> c_int;
type FnThumbnail = unsafe extern "C" fn(*const c_char, *mut *mut VipsImage, c_int, ...) -> c_int;
type FnImgOutInt = unsafe extern "C" fn(*mut VipsImage, *mut *mut VipsImage, c_int, ...) -> c_int;
type FnSave = unsafe extern "C" fn(*mut VipsImage, *const c_char, ...) -> c_int;
type FnNewFromFile = unsafe extern "C" fn(*const c_char, ...) -> *mut VipsImage;
type FnNewFromBuffer =
    unsafe extern "C" fn(*const c_void, usize, *const c_char, ...) -> *mut VipsImage;
type FnCopyMemory = unsafe extern "C" fn(*mut VipsImage) -> *mut VipsImage;
type FnGetInt = unsafe extern "C" fn(*const VipsImage) -> c_int;
type FnErrorBuffer = unsafe extern "C" fn() -> *const c_char;
type FnVoid = unsafe extern "C" fn();
type FnSetInt = unsafe extern "C" fn(c_int);
type FnUnref = unsafe extern "C" fn(*mut c_void);
type FnGetData = unsafe extern "C" fn(*mut VipsImage) -> *const c_void;

/// `VIPS_FOREIGN_KEEP_ICC`: the colour profile, without which a wide-gamut
/// (Adobe RGB, Display P3) thumbnail would show washed out.
pub const KEEP_ICC: c_int = 1 << 3;
/// `VIPS_FOREIGN_KEEP_NONE`.
pub const KEEP_NONE: c_int = 0;

fn env_int(name: &str) -> Option<c_int> {
    std::env::var(name).ok()?.trim().parse().ok()
}

/// `LP_THUMB_KEEP`: which metadata thumbnails carry over from the original:
/// `icc` (default: the colour profile only), `all` (libvips' default: EXIF
/// with GPS, XMP, IPTC, ICC; thumbnails are what shared and public views
/// load, so that leaks the location) or `none` (wide-gamut photos then show
/// washed out). Pixels and so pHash are the same either way.
fn thumbnail_keep() -> Option<c_int> {
    match std::env::var("LP_THUMB_KEEP")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "all" => None,
        "icc" | "" => Some(KEEP_ICC),
        "none" => Some(KEEP_NONE),
        other => {
            tracing::warn!(value = other, "LP_THUMB_KEEP: expected icc, all or none");
            Some(KEEP_ICC)
        }
    }
}

/// `VIPS_FORMAT_UCHAR`.
const FORMAT_UCHAR: c_int = 0;

pub struct Vips {
    _lib: Library,
    thumbnail: FnThumbnail,
    thumbnail_image: FnImgOutInt,
    rot: FnImgOutInt,
    flip: FnImgOutInt,
    webpsave: FnSave,
    new_from_file: FnNewFromFile,
    new_from_buffer: FnNewFromBuffer,
    copy_memory: FnCopyMemory,
    get_width: FnGetInt,
    get_height: FnGetInt,
    error_buffer: FnErrorBuffer,
    error_clear: FnVoid,
    unref: FnUnref,
    /// `keep` for webpsave (`VipsForeignKeep` flags, `LP_THUMB_KEEP`); None =
    /// libvips' default, every piece of metadata (EXIF with GPS, XMP, IPTC, ICC).
    keep: Option<c_int>,
    /// Pixel readout for [`Vips::decode_rgb8`]; optional so a libvips
    /// without it still renders thumbnails.
    pixels: Option<(FnGetInt, FnGetInt, FnGetData)>,
}

// libvips is thread-safe; the function pointers are plain code addresses.
unsafe impl Send for Vips {}
unsafe impl Sync for Vips {}

static VIPS: OnceLock<Option<Vips>> = OnceLock::new();

/// The process-wide libvips, loaded on first use from `path`. None when no
/// library is configured or it cannot be loaded (callers fall back).
pub fn get(path: Option<&Path>) -> Option<&'static Vips> {
    VIPS.get_or_init(|| {
        let path = path?;
        match unsafe { Vips::load(path) } {
            Ok(v) => Some(v),
            Err(e) => {
                tracing::warn!(lib = %path.display(), error = %e, "libvips not loaded; using the Rust fallback");
                None
            }
        }
    })
    .as_ref()
}

macro_rules! sym {
    ($lib:expr, $name:literal) => {
        *$lib
            .get(concat!($name, "\0").as_bytes())
            .map_err(|e| format!("{}: {e}", $name))?
    };
}

impl Vips {
    unsafe fn load(path: &Path) -> Result<Vips, String> {
        let lib = unsafe { Library::new(path) }.map_err(|e| e.to_string())?;
        let v = unsafe {
            let init: FnInit = sym!(lib, "vips_init");
            let cache_max: FnSetInt = sym!(lib, "vips_cache_set_max");
            let concurrency: FnSetInt = sym!(lib, "vips_concurrency_set");
            let argv0 = CString::new("librephotos-rs").expect("no nul");
            if init(argv0.as_ptr()) != 0 {
                return Err("vips_init failed".into());
            }
            // No operation cache: a cached load keeps the file open (Windows
            // then refuses to delete or rewrite it) and hands back stale
            // pixels for a file changed in place.
            // (With nothing cached, `vips_cache_set_max_mem` has nothing to cap.)
            cache_max(0);
            // Threads per libvips operation (`LP_VIPS_CONCURRENCY`, 0 = one
            // per core). Scan workers already run side by side: 1 is as fast
            // as 2 with 4 file groups and 6% faster with 8, one per core is
            // slower still (`bench/OPTIMIZATIONS.md` #3, #21).
            let threads = env_int("LP_VIPS_CONCURRENCY").unwrap_or(1);
            concurrency(threads.max(0));
            Vips {
                thumbnail: sym!(lib, "vips_thumbnail"),
                thumbnail_image: sym!(lib, "vips_thumbnail_image"),
                rot: sym!(lib, "vips_rot"),
                flip: sym!(lib, "vips_flip"),
                webpsave: sym!(lib, "vips_webpsave"),
                new_from_file: sym!(lib, "vips_image_new_from_file"),
                new_from_buffer: sym!(lib, "vips_image_new_from_buffer"),
                copy_memory: sym!(lib, "vips_image_copy_memory"),
                get_width: sym!(lib, "vips_image_get_width"),
                get_height: sym!(lib, "vips_image_get_height"),
                error_buffer: sym!(lib, "vips_error_buffer"),
                error_clear: sym!(lib, "vips_error_clear"),
                unref: sym!(lib, "g_object_unref"),
                keep: thumbnail_keep(),
                pixels: (|| -> Result<_, String> {
                    Ok((
                        sym!(lib, "vips_image_get_bands"),
                        sym!(lib, "vips_image_get_format"),
                        sym!(lib, "vips_image_get_data"),
                    ))
                })()
                .ok(),
                _lib: lib,
            }
        };
        Ok(v)
    }

    fn error(&self, what: &str) -> String {
        unsafe {
            let p = (self.error_buffer)();
            let msg = if p.is_null() {
                String::new()
            } else {
                CStr::from_ptr(p).to_string_lossy().trim().to_string()
            };
            (self.error_clear)();
            if msg.is_empty() {
                format!("{what} failed")
            } else {
                format!("{what}: {msg}")
            }
        }
    }

    fn wrap(&'static self, p: *mut VipsImage, what: &str) -> Result<Image, String> {
        if p.is_null() {
            Err(self.error(what))
        } else {
            Ok(Image { ptr: p, vips: self })
        }
    }

    /// `pyvips.Image.new_from_file(path)`: header only, no pixel decode.
    pub fn can_load(&'static self, path: &Path) -> bool {
        let Ok(c) = CString::new(path.to_string_lossy().as_bytes()) else {
            return false;
        };
        let p = unsafe { (self.new_from_file)(c.as_ptr(), ptr::null::<c_char>()) };
        self.wrap(p, "load").is_ok()
    }

    /// `pyvips.Image.thumbnail(f"{path}[revalidate]", 10000, height=h, size=DOWN).copy_memory()`.
    pub fn thumbnail_file(&'static self, path: &Path, height: i32) -> Result<Image, String> {
        let c = CString::new(format!("{}[revalidate]", path.to_string_lossy()))
            .map_err(|e| e.to_string())?;
        let mut out: *mut VipsImage = ptr::null_mut();
        let rc = unsafe {
            (self.thumbnail)(
                c.as_ptr(),
                &mut out,
                10000 as c_int,
                c"height".as_ptr(),
                height as c_int,
                c"size".as_ptr(),
                SIZE_DOWN,
                ptr::null::<c_char>(),
            )
        };
        if rc != 0 {
            return Err(self.error("thumbnail"));
        }
        let img = self.wrap(out, "thumbnail")?;
        img.copy_memory()
    }

    /// Load an encoded image from memory (`new_from_buffer(data, "")`).
    pub fn load_buffer(&'static self, data: &[u8]) -> Result<Image, String> {
        let p = unsafe {
            (self.new_from_buffer)(
                data.as_ptr() as *const c_void,
                data.len(),
                c"".as_ptr(),
                ptr::null::<c_char>(),
            )
        };
        self.wrap(p, "load_buffer")
    }
}

impl Vips {
    /// Decode an encoded image to 8-bit RGB (`(width, height, pixels)`) as
    /// libjpeg-turbo does for Pillow and cv2: no EXIF rotation, grey
    /// replicated. `None` when the pixels cannot be read out or are not
    /// 8-bit grey / RGB (CMYK, alpha, 16-bit): the caller decodes those.
    #[allow(clippy::type_complexity)]
    pub fn decode_rgb8(&'static self, data: &[u8]) -> Option<Result<(u32, u32, Vec<u8>), String>> {
        let (get_bands, get_format, get_data) = self.pixels?;
        let img = match self.load_buffer(data) {
            Ok(i) => i,
            Err(e) => return Some(Err(e)),
        };
        let (bands, format) = unsafe { (get_bands(img.ptr), get_format(img.ptr)) };
        if format != FORMAT_UCHAR || !(bands == 1 || bands == 3) {
            return None;
        }
        let mem = match img.copy_memory() {
            Ok(m) => m,
            Err(e) => return Some(Err(e)),
        };
        let (w, h) = (mem.width().max(0) as usize, mem.height().max(0) as usize);
        let p = unsafe { get_data(mem.ptr) } as *const u8;
        if p.is_null() {
            return Some(Err(self.error("get_data")));
        }
        // SAFETY: a memory image of w x h uchar pixels with `bands` bands,
        // alive (and unchanged) while `mem` is.
        let px = unsafe { std::slice::from_raw_parts(p, w * h * bands as usize) };
        let rgb = if bands == 3 {
            px.to_vec()
        } else {
            px.iter().flat_map(|&v| [v, v, v]).collect()
        };
        Some(Ok((w as u32, h as u32, rgb)))
    }
}

/// Make in-process ML decode JPEG through libvips (libjpeg-turbo, bit-exact
/// with Pillow and cv2) instead of the Rust decoder, which is a few levels
/// off. Other formats keep the Rust decoders (already exact). libvips is
/// loaded on the first JPEG; without it the Rust decoder is used.
pub fn install_ml_decoder(vips_lib: Option<std::path::PathBuf>) -> bool {
    lp_ml::preprocess::set_decoder(Box::new(move |path| {
        let mut magic = [0u8; 3];
        std::io::Read::read_exact(&mut std::fs::File::open(path).ok()?, &mut magic).ok()?;
        if magic != [0xFF, 0xD8, 0xFF] {
            return None;
        }
        let v = get(vips_lib.as_deref())?;
        let data = std::fs::read(path).ok()?;
        // libjpeg-turbo pads a cut JPEG with grey; Pillow and cv2 refuse it,
        // which `load_rgb`'s own path reproduces.
        if lp_ml::preprocess::jpeg_truncated(&data) {
            return None;
        }
        let (w, h, rgb) = match v.decode_rgb8(&data)? {
            Ok(d) => d,
            Err(e) => return Some(Err(anyhow::anyhow!("decoding {}: {e}", path.display()))),
        };
        image::RgbImage::from_raw(w, h, rgb).map(Ok)
    }))
}

/// An owned `VipsImage` reference.
pub struct Image {
    ptr: *mut VipsImage,
    vips: &'static Vips,
}

// GObject reference counting is atomic; images move between blocking threads.
unsafe impl Send for Image {}

impl Drop for Image {
    fn drop(&mut self) {
        unsafe { (self.vips.unref)(self.ptr as *mut c_void) }
    }
}

impl Image {
    pub fn width(&self) -> i32 {
        unsafe { (self.vips.get_width)(self.ptr) }
    }

    pub fn height(&self) -> i32 {
        unsafe { (self.vips.get_height)(self.ptr) }
    }

    pub fn copy_memory(&self) -> Result<Image, String> {
        let p = unsafe { (self.vips.copy_memory)(self.ptr) };
        self.vips.wrap(p, "copy_memory")
    }

    /// The pixels as 8-bit RGB, what Pillow's `convert("RGB")` gives for the
    /// image's WebP: grey replicated, alpha dropped. `None` for other formats
    /// (16-bit, CMYK, ...) or when libvips cannot read pixels out.
    pub fn to_rgb8(&self) -> Option<image::RgbImage> {
        let (get_bands, get_format, get_data) = self.vips.pixels?;
        let (bands, format) = unsafe { (get_bands(self.ptr), get_format(self.ptr)) };
        if format != FORMAT_UCHAR || !(1..=4).contains(&bands) {
            return None;
        }
        let mem = self.copy_memory().ok()?;
        let (w, h) = (mem.width().max(0) as usize, mem.height().max(0) as usize);
        let p = unsafe { get_data(mem.ptr) } as *const u8;
        if p.is_null() || w == 0 || h == 0 {
            return None;
        }
        let b = bands as usize;
        // SAFETY: a memory image of w x h uchar pixels with `b` bands,
        // alive (and unchanged) while `mem` is.
        let px = unsafe { std::slice::from_raw_parts(p, w * h * b) };
        let rgb: Vec<u8> = match b {
            3 => px.to_vec(),
            4 => px
                .chunks_exact(4)
                .flat_map(|c| [c[0], c[1], c[2]])
                .collect(),
            _ => px
                .chunks_exact(b)
                .flat_map(|c| [c[0], c[0], c[0]])
                .collect(),
        };
        image::RgbImage::from_raw(w as u32, h as u32, rgb)
    }

    fn op_int(&self, f: FnImgOutInt, arg: c_int, what: &str) -> Result<Image, String> {
        let mut out: *mut VipsImage = ptr::null_mut();
        let rc = unsafe { f(self.ptr, &mut out, arg, ptr::null::<c_char>()) };
        if rc != 0 {
            return Err(self.vips.error(what));
        }
        self.vips.wrap(out, what)
    }

    pub fn rot(&self, angle: c_int) -> Result<Image, String> {
        self.op_int(self.vips.rot, angle, "rot")
    }

    pub fn flip(&self, direction: c_int) -> Result<Image, String> {
        self.op_int(self.vips.flip, direction, "flip")
    }

    /// `image.thumbnail_image(10000, height=h, size=DOWN)`.
    pub fn thumbnail_image(&self, height: i32) -> Result<Image, String> {
        let mut out: *mut VipsImage = ptr::null_mut();
        let rc = unsafe {
            (self.vips.thumbnail_image)(
                self.ptr,
                &mut out,
                10000 as c_int,
                c"height".as_ptr(),
                height as c_int,
                c"size".as_ptr(),
                SIZE_DOWN,
                ptr::null::<c_char>(),
            )
        };
        if rc != 0 {
            return Err(self.vips.error("thumbnail_image"));
        }
        self.vips.wrap(out, "thumbnail_image")
    }

    /// `write_to_file(path, Q=q, effort=effort)` for a `.webp` path;
    /// `effort` None leaves libwebp's default (the legacy render).
    pub fn webpsave(&self, path: &Path, q: i32, effort: Option<i32>) -> Result<(), String> {
        let c = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let save = self.vips.webpsave;
        let (p, out, q) = (self.ptr, c.as_ptr(), q as c_int);
        let rc = unsafe {
            match (effort, self.vips.keep) {
                (Some(e), Some(k)) => save(
                    p,
                    out,
                    c"Q".as_ptr(),
                    q,
                    c"effort".as_ptr(),
                    e as c_int,
                    c"keep".as_ptr(),
                    k,
                    ptr::null::<c_char>(),
                ),
                (Some(e), None) => save(
                    p,
                    out,
                    c"Q".as_ptr(),
                    q,
                    c"effort".as_ptr(),
                    e as c_int,
                    ptr::null::<c_char>(),
                ),
                (None, Some(k)) => save(
                    p,
                    out,
                    c"Q".as_ptr(),
                    q,
                    c"keep".as_ptr(),
                    k,
                    ptr::null::<c_char>(),
                ),
                (None, None) => save(p, out, c"Q".as_ptr(), q, ptr::null::<c_char>()),
            }
        };
        if rc != 0 {
            return Err(self.vips.error("webpsave"));
        }
        Ok(())
    }
}
