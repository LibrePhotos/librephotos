use std::path::PathBuf;

pub const DIR_NAME: &str = "com.librephotos.viewer";

pub fn data_dir() -> Option<PathBuf> {
    if let Some(d) = override_dir() {
        return Some(d);
    }
    let env_dir = |k: &str| {
        std::env::var_os(k)
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
    };
    if cfg!(windows) {
        env_dir("LOCALAPPDATA").map(|d| d.join(DIR_NAME))
    } else if cfg!(target_os = "macos") {
        env_dir("HOME").map(|d| d.join("Library/Application Support").join(DIR_NAME))
    } else {
        env_dir("XDG_DATA_HOME")
            .or_else(|| env_dir("HOME").map(|h| h.join(".local/share")))
            .map(|d| d.join(DIR_NAME))
    }
}

pub fn override_dir() -> Option<PathBuf> {
    std::env::var_os("LPVIEW_DATA_DIR")
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
}

pub fn keyring_service() -> String {
    std::env::var("LPVIEW_KEYRING_SERVICE")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "LibrePhotos Viewer".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn data_folder_is_the_bundle_identifier_the_uninstaller_deletes() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"].as_str(), Some(super::DIR_NAME));
    }
}
