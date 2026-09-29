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
            cache_max(0);
            concurrency(2);
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
        let rc = unsafe {
            match effort {
                Some(e) => (self.vips.webpsave)(
                    self.ptr,
                    c.as_ptr(),
                    c"Q".as_ptr(),
                    q as c_int,
                    c"effort".as_ptr(),
                    e as c_int,
                    ptr::null::<c_char>(),
                ),
                None => (self.vips.webpsave)(
                    self.ptr,
                    c.as_ptr(),
                    c"Q".as_ptr(),
                    q as c_int,
                    ptr::null::<c_char>(),
                ),
            }
        };
        if rc != 0 {
            return Err(self.vips.error("webpsave"));
        }
        Ok(())
    }
}
