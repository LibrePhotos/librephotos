//! In-process RAW rendering (port of `service/thumbnail`): rawler decodes,
//! [`develop`](super::develop) reproduces rawpy's `postprocess`, then the
//! libvips thumbnail geometry and WebP Q95. No model files.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::SidecarError;
use tokio::sync::Semaphore;

use super::RawThumbnailApi;
use crate::{Backend, MlContext, Service};

pub struct InProcess {
    ctx: Arc<MlContext>,
    /// `LP_ML_RAW_THUMBNAIL_CONCURRENCY` (default 1, like the sidecar).
    permits: Arc<Semaphore>,
}

impl InProcess {
    /// Set to true once the port passes its goldens; `auto` mode then uses it.
    pub const IMPLEMENTED: bool = true;

    pub fn new(ctx: Arc<MlContext>) -> Self {
        let permits = Arc::new(Semaphore::new(ctx.concurrency(Service::RawThumbnail)));
        InProcess { ctx, permits }
    }
}

impl Backend for InProcess {
    fn implemented(&self) -> bool {
        Self::IMPLEMENTED
    }

    /// No model files.
    fn ready(&self) -> bool {
        true
    }
}

#[async_trait]
impl RawThumbnailApi for InProcess {
    async fn render_thumbnail(
        &self,
        source: &str,
        destination: &str,
        height: u32,
    ) -> Result<String, SidecarError> {
        let s = Service::RawThumbnail;
        // The sidecar's guard: only ever write under the media root.
        if !inside(self.ctx.media_root(), Path::new(destination)) {
            return Err(crate::bad_input(s, "destination is outside the media root"));
        }
        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|_| crate::failed(s, "shutting down"))?;
        let (src, dst) = (PathBuf::from(source), PathBuf::from(destination));
        tokio::task::spawn_blocking(move || super::render_raw(&src, &dst, height))
            .await
            .map_err(|e| crate::failed(s, format!("render task: {e}")))?
            .map_err(|e| crate::failed(s, format!("{e:#}")))?;
        Ok(destination.to_string())
    }
}

/// `_inside_media_root`: `destination`, symlinks and `..` resolved, is under `root`.
fn inside(root: &Path, destination: &Path) -> bool {
    let Some(root) = resolve(root) else {
        return false;
    };
    resolve(destination).is_some_and(|p| p.starts_with(&root))
}

/// `os.path.realpath`: the longest existing prefix canonicalized, the rest
/// joined lexically.
fn resolve(p: &Path) -> Option<PathBuf> {
    let abs = std::path::absolute(p).ok()?;
    let mut rest = Vec::new();
    let mut cur = abs.as_path();
    loop {
        if let Ok(c) = cur.canonicalize() {
            let mut out = c;
            for part in rest.iter().rev() {
                match part {
                    Component::ParentDir => {
                        out.pop();
                    }
                    Component::Normal(n) => out.push(n),
                    _ => {}
                }
            }
            return Some(out);
        }
        rest.push(cur.components().next_back()?);
        cur = cur.parent()?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destination_must_stay_in_the_media_root() {
        let root = tempfile::tempdir().unwrap();
        let r = root.path();
        assert!(inside(r, &r.join("thumbnails_big").join("x.webp")));
        assert!(inside(r, &r.join("a").join("..").join("x.webp")));
        assert!(!inside(r, &r.join("..").join("x.webp")));
        assert!(!inside(
            r,
            &r.join("a").join("..").join("..").join("x.webp")
        ));
        assert!(!inside(r, Path::new("/elsewhere/x.webp")));
    }
}
