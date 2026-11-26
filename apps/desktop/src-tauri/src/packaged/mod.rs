pub mod import;

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub family_name: String,
    pub app_user_model_id: String,
}

impl Identity {
    pub fn from_app_user_model_id(aumid: &str) -> Option<Identity> {
        let (family_name, app) = aumid.split_once('!')?;
        (!family_name.is_empty() && !app.is_empty()).then(|| Identity {
            family_name: family_name.to_string(),
            app_user_model_id: aumid.to_string(),
        })
    }
}

pub fn identity() -> Option<&'static Identity> {
    static IDENTITY: OnceLock<Option<Identity>> = OnceLock::new();
    IDENTITY.get_or_init(read_identity).as_ref()
}

#[cfg(windows)]
fn read_identity() -> Option<Identity> {
    use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS};
    use windows::Win32::Storage::Packaging::Appx::GetCurrentApplicationUserModelId;
    use windows::core::PWSTR;
    let mut len = 0u32;
    if unsafe { GetCurrentApplicationUserModelId(&mut len, None) } != ERROR_INSUFFICIENT_BUFFER {
        return None;
    }
    let mut buf = vec![0u16; len as usize];
    if unsafe { GetCurrentApplicationUserModelId(&mut len, Some(PWSTR(buf.as_mut_ptr()))) }
        != ERROR_SUCCESS
    {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Identity::from_app_user_model_id(&String::from_utf16(&buf[..end]).ok()?)
}

#[cfg(not(windows))]
fn read_identity() -> Option<Identity> {
    None
}

pub fn data_root(local_app_data: &Path, family_name: &str) -> PathBuf {
    local_app_data
        .join("Packages")
        .join(family_name)
        .join("LocalCache")
        .join("Local")
        .join(crate::appdirs::DIR_NAME)
}

pub fn data_dir() -> Option<PathBuf> {
    let identity = identity()?;
    let local = std::env::var_os("LOCALAPPDATA").filter(|d| !d.is_empty())?;
    Some(data_root(Path::new(&local), &identity.family_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_family_name_from_the_app_user_model_id() {
        let id = Identity::from_app_user_model_id("LibrePhotos.Viewer_8wekyb3d8bbwe!App").unwrap();
        assert_eq!(id.family_name, "LibrePhotos.Viewer_8wekyb3d8bbwe");
        assert_eq!(id.app_user_model_id, "LibrePhotos.Viewer_8wekyb3d8bbwe!App");
        assert_eq!(Identity::from_app_user_model_id("no-bang"), None);
        assert_eq!(Identity::from_app_user_model_id("!App"), None);
        assert_eq!(Identity::from_app_user_model_id("Family!"), None);
    }

    #[test]
    fn packaged_data_lives_where_virtualised_writes_to_the_data_folder_land() {
        let root = data_root(
            Path::new(r"C:\Users\u\AppData\Local"),
            "LibrePhotos.Viewer_8wekyb3d8bbwe",
        );
        assert_eq!(
            root,
            Path::new(r"C:\Users\u\AppData\Local")
                .join("Packages")
                .join("LibrePhotos.Viewer_8wekyb3d8bbwe")
                .join("LocalCache")
                .join("Local")
                .join("com.librephotos.viewer")
        );
    }

    #[test]
    fn an_unpackaged_test_process_has_no_identity() {
        assert_eq!(identity(), None);
        assert_eq!(data_dir(), None);
    }
}
