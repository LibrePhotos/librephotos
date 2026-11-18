//! Where the app keeps its state: `LPVIEW_DATA_DIR` moves all of it (library database, server
//! settings, thumbnail/tile/server-media caches) so tests never touch the user's own.

use std::path::PathBuf;

/// The app's data directory: `LPVIEW_DATA_DIR`, else `%LOCALAPPDATA%\LibrePhotos Viewer`
/// (macOS `~/Library/Application Support/LibrePhotos Viewer`, else `$XDG_DATA_HOME/librephotos-viewer`).
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
        env_dir("LOCALAPPDATA").map(|d| d.join("LibrePhotos Viewer"))
    } else if cfg!(target_os = "macos") {
        env_dir("HOME").map(|d| d.join("Library/Application Support/LibrePhotos Viewer"))
    } else {
        env_dir("XDG_DATA_HOME")
            .or_else(|| env_dir("HOME").map(|h| h.join(".local/share")))
            .map(|d| d.join("librephotos-viewer"))
    }
}

/// `LPVIEW_DATA_DIR` when set: every cache moves under it too.
pub fn override_dir() -> Option<PathBuf> {
    std::env::var_os("LPVIEW_DATA_DIR")
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
}

/// The keychain service the server's refresh token is stored under (`LPVIEW_KEYRING_SERVICE`
/// for tests).
pub fn keyring_service() -> String {
    std::env::var("LPVIEW_KEYRING_SERVICE")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "LibrePhotos Viewer".into())
}
