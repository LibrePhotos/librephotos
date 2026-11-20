use std::path::Path;

use crate::formats::{ext_of, is_jpeg};
use crate::jpegmeta;
use crate::listing::modified_ms;
use crate::orient;

pub fn trash_file(path: &str) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err(format!("{path} not found"));
    }
    trash::delete(path).map_err(|e| e.to_string())
}

pub fn rotate_file(path: &str, clockwise: bool) -> Result<i64, String> {
    let p = Path::new(path);
    let ext = ext_of(p);
    if is_jpeg(&ext) {
        let head = jpegmeta::read_head(p).map_err(|e| e.to_string())?;
        let o = jpegmeta::parse_head(&head)
            .ok_or("not a JPEG file")?
            .orientation;
        jpegmeta::set_file_orientation(p, orient::rotated(o, clockwise))?;
    } else if matches!(ext.as_str(), "tif" | "tiff") {
        let head = std::fs::read(p).map_err(|e| e.to_string())?;
        let o = jpegmeta::tiff_orientation(&head);
        jpegmeta::set_tiff_file_orientation(p, orient::rotated(o, clockwise))?;
    } else if matches!(ext.as_str(), "png" | "bmp") {
        rotate_reencode(p, clockwise)?;
    } else {
        return Err(format!(
            "rotating .{ext} files on disk is not supported; rotated in view only"
        ));
    }
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    Ok(modified_ms(&meta))
}

fn rotate_reencode(p: &Path, clockwise: bool) -> Result<(), String> {
    let img = image::open(p).map_err(|e| e.to_string())?;
    let img = if clockwise {
        img.rotate90()
    } else {
        img.rotate270()
    };
    let fmt = image::ImageFormat::from_path(p).map_err(|e| e.to_string())?;
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, fmt).map_err(|e| e.to_string())?;
    jpegmeta::replace_file(p, buf.get_ref())
}

pub fn reveal_in_folder(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("{path} not found"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn checked_web_url(url: &str) -> Result<&str, String> {
    let ok = url.starts_with("https://")
        && url.len() < 2048
        && !url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '"' | '\'' | '<' | '>'));
    ok.then_some(url)
        .ok_or_else(|| "only https links can be opened".to_string())
}

pub fn open_external(url: &str) -> Result<(), String> {
    let url = checked_web_url(url)?;
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

pub const CLIPBOARD_EDGE: u32 = 5120;

pub fn copy_image(path: &str) -> Result<(), String> {
    let px = crate::decode::pixels(Path::new(path), CLIPBOARD_EDGE)?;
    let (width, height) = (px.width as usize, px.height as usize);
    let bytes = px.into_rgba();
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_image(arboard::ImageData {
        width,
        height,
        bytes: bytes.into(),
    })
    .map_err(|e| e.to_string())
}

pub const REGISTERED_APP_NAME: &str = "LibrePhotos Viewer";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Registration {
    User,
    Machine,
    None,
}

pub fn default_apps_uri(reg: Registration) -> String {
    let name = percent_encoding::utf8_percent_encode(
        REGISTERED_APP_NAME,
        percent_encoding::NON_ALPHANUMERIC,
    );
    match reg {
        Registration::User => format!("ms-settings:defaultapps?registeredAppUser={name}"),
        Registration::Machine => format!("ms-settings:defaultapps?registeredAppMachine={name}"),
        Registration::None => "ms-settings:defaultapps".into(),
    }
}

#[cfg(windows)]
fn registration() -> Registration {
    use windows::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW,
    };
    use windows::core::{HSTRING, w};
    let name = HSTRING::from(REGISTERED_APP_NAME);
    let has = |root: HKEY| unsafe {
        RegGetValueW(
            root,
            w!(r"Software\RegisteredApplications"),
            &name,
            RRF_RT_REG_SZ,
            None,
            None,
            None,
        )
        .is_ok()
    };
    if has(HKEY_CURRENT_USER) {
        Registration::User
    } else if has(HKEY_LOCAL_MACHINE) {
        Registration::Machine
    } else {
        Registration::None
    }
}

#[cfg(windows)]
pub fn open_default_apps_settings() -> Result<(), String> {
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::{HSTRING, w};
    let open = |uri: &str| {
        let r = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                &HSTRING::from(uri),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        r.0 as usize > 32
    };
    let reg = registration();
    if open(&default_apps_uri(reg))
        || (reg != Registration::None && open(&default_apps_uri(Registration::None)))
    {
        Ok(())
    } else {
        Err("couldn't open Settings".into())
    }
}

#[cfg(not(windows))]
pub fn open_default_apps_settings() -> Result<(), String> {
    Err("Setting the default photo viewer from the app isn't supported on this system yet".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_plain_https_links() {
        assert!(checked_web_url("https://www.openstreetmap.org/?mlat=1&mlon=2#map=15/1/2").is_ok());
        assert!(checked_web_url("http://example.com").is_err());
        assert!(checked_web_url("https://a b").is_err());
        assert!(checked_web_url("https://x\"&calc").is_err());
        assert!(checked_web_url("file:///C:/x").is_err());
    }

    #[test]
    fn default_apps_uris() {
        assert_eq!(
            default_apps_uri(Registration::User),
            "ms-settings:defaultapps?registeredAppUser=LibrePhotos%20Viewer"
        );
        assert_eq!(
            default_apps_uri(Registration::Machine),
            "ms-settings:defaultapps?registeredAppMachine=LibrePhotos%20Viewer"
        );
        assert_eq!(
            default_apps_uri(Registration::None),
            "ms-settings:defaultapps"
        );
    }

    #[test]
    fn rotates_png_losslessly_and_refuses_others() {
        let dir = std::env::temp_dir().join(format!("lpview-ops-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("r.png");
        let mut img = image::RgbImage::new(4, 2);
        img.put_pixel(0, 0, image::Rgb([255, 0, 0]));
        img.save(&p).unwrap();
        rotate_file(p.to_str().unwrap(), true).unwrap();
        let r = image::open(&p).unwrap().into_rgb8();
        assert_eq!(r.dimensions(), (2, 4));
        assert_eq!(
            r.get_pixel(1, 0),
            &image::Rgb([255, 0, 0]),
            "top-left moved to top-right"
        );
        let w = dir.join("x.webp");
        std::fs::write(&w, b"RIFF").unwrap();
        assert!(rotate_file(w.to_str().unwrap(), true).is_err());
    }
}
