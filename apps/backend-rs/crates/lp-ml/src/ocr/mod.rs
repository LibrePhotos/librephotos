//! PP-OCRv6 text recognition (`service/ocr`, sidecar :8012). Contract:
//! `POST /ocr {image_path, min_confidence=0.6, max_side?, det_only?}` ->
//! `{text, blocks, image_width, image_height, mean_confidence,
//! text_area_fraction}`; a missing or undecodable image is a 400. The Python
//! sidecar always loads `ppocrv6_small` (or `OCR_MODEL_DIR`) and ignores the
//! `OCR_MODEL` site setting; the port uses the selected bundle
//! (`ctx.selection().ocr_model`).

mod inprocess;

pub use inprocess::InProcess;

use async_trait::async_trait;
use lp_sidecars::{OcrResult, SidecarError, Sidecars};

#[async_trait]
pub trait OcrApi: Send + Sync {
    async fn ocr(&self, image_path: &str, min_confidence: f64) -> Result<OcrResult, SidecarError>;
}

#[async_trait]
impl OcrApi for Sidecars {
    async fn ocr(&self, image_path: &str, min_confidence: f64) -> Result<OcrResult, SidecarError> {
        Sidecars::ocr(self, image_path, min_confidence).await
    }
}
