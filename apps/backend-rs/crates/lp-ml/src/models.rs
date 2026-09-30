//! The model store, a port of `api/ml_models.py`: the catalog with its
//! sha256 pins, the site-setting driven selection, and downloads streamed to
//! `<target>.part`, verified, then renamed into place (nothing that is not a
//! complete, verified file ever reaches the target path). Same layout under
//! `MEDIA_ROOT/data_models`, so Django and Rust share one model directory.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, anyhow, bail};
use futures::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MlType {
    Captioning,
    FaceRecognition,
    Clip,
    Tagging,
    Ocr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unpack {
    /// A single file stored at `target_dir`.
    None,
    /// `tar -zxC`: extracted into the data_models root.
    TarGz,
    /// `zip`: extracted into `target_dir`, a lone wrapper folder flattened.
    Zip,
}

#[derive(Debug, Clone, Copy)]
pub struct ExtraFile {
    pub url: &'static str,
    pub target: &'static str,
    pub sha256: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub struct ModelSpec {
    pub id: u32,
    pub name: &'static str,
    pub url: &'static str,
    pub ml_type: MlType,
    pub unpack: Unpack,
    /// Relative to data_models: the file (no unpack) or directory.
    pub target_dir: &'static str,
    pub sha256: &'static str,
    pub additional_files: &'static [ExtraFile],
}

/// `ML_MODELS`, in the same order (the download job's progress follows it).
pub static CATALOG: &[ModelSpec] = &[
    ModelSpec {
        id: 2,
        name: "clip_vit_b32",
        url: "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx",
        ml_type: MlType::Clip,
        unpack: Unpack::None,
        target_dir: "clip_vit_b32/vision_model.onnx",
        sha256: "fd6e1402a588279d1723c7534d4bcba5bc0b14b47dfab0e46f8c47b8270d7d40",
        additional_files: &[
            ExtraFile {
                url: "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model.onnx",
                target: "clip_vit_b32/text_model.onnx",
                sha256: "3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc",
            },
            ExtraFile {
                url: "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json",
                target: "clip_vit_b32/tokenizer.json",
                sha256: "f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd",
            },
        ],
    },
    ModelSpec {
        id: 3,
        name: "mobileclip_s2",
        url: "https://huggingface.co/Xenova/mobileclip_s2/resolve/main/onnx/vision_model.onnx",
        ml_type: MlType::Tagging,
        unpack: Unpack::None,
        target_dir: "mobileclip_s2/vision_model.onnx",
        sha256: "d28b92d7a3a6ba99bd000cce5c91678c0e279dc934c887a3785908a811872a6c",
        additional_files: &[
            ExtraFile {
                url: "https://huggingface.co/Xenova/mobileclip_s2/resolve/main/onnx/text_model.onnx",
                target: "mobileclip_s2/text_model.onnx",
                sha256: "ff82e945c6c652c51df687e10f102a8e43c87d37c9108ff692468be3732f3710",
            },
            ExtraFile {
                url: "https://huggingface.co/Xenova/mobileclip_s2/resolve/main/tokenizer.json",
                target: "mobileclip_s2/tokenizer.json",
                sha256: "72ed5c96db5729294468543e4bc75fce14ca63f58e37300290189ba1c1e52b85",
            },
        ],
    },
    // InsightFace bundles: non-commercial research licence, upstream URLs only.
    ModelSpec {
        id: 5,
        name: "buffalo_sc",
        url: "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip",
        ml_type: MlType::FaceRecognition,
        unpack: Unpack::Zip,
        target_dir: "face_recognition/models/buffalo_sc",
        sha256: "57d31b56b6ffa911c8a73cfc1707c73cab76efe7f13b675a05223bf42de47c72",
        additional_files: &[],
    },
    ModelSpec {
        id: 7,
        name: "buffalo_s",
        url: "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip",
        ml_type: MlType::FaceRecognition,
        unpack: Unpack::Zip,
        target_dir: "face_recognition/models/buffalo_s",
        sha256: "d85a87f503f691807cd8bb97128bdf7a0660326cd9cd02657127fa978bab8b5e",
        additional_files: &[],
    },
    ModelSpec {
        id: 18,
        name: "lfm2_vl_450m",
        url: "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/vision_encoder_q4.onnx",
        ml_type: MlType::Captioning,
        unpack: Unpack::None,
        target_dir: "lfm2_vl_450m/vision_encoder_q4.onnx",
        sha256: "3457fe118939ecd52183660abafbbd32c810f41a0e8d1119a1f07ca2d4d9dcfc",
        additional_files: &[
            ExtraFile {
                url: "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/vision_encoder_q4.onnx_data",
                target: "lfm2_vl_450m/vision_encoder_q4.onnx_data",
                sha256: "03171ff302af006d2e5f55f9c09531d7938565626334809c94e6de54afc840b5",
            },
            ExtraFile {
                url: "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/embed_tokens_q4.onnx",
                target: "lfm2_vl_450m/embed_tokens_q4.onnx",
                sha256: "f0d663cbf75fc6a0c7b9669177335139b0c5a63575c6413037d48501eea0c4a5",
            },
            ExtraFile {
                url: "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/embed_tokens_q4.onnx_data",
                target: "lfm2_vl_450m/embed_tokens_q4.onnx_data",
                sha256: "255994cbb7269ea24b43d3d57a7e64dcb54da69c77ea612f9c32af3dbb95158e",
            },
            ExtraFile {
                url: "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/decoder_model_merged_q4.onnx",
                target: "lfm2_vl_450m/decoder_model_merged_q4.onnx",
                sha256: "00b4c0ed1008194b6ed813e5d17724db122ef71e963197424022aaf93966515a",
            },
            ExtraFile {
                url: "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/decoder_model_merged_q4.onnx_data",
                target: "lfm2_vl_450m/decoder_model_merged_q4.onnx_data",
                sha256: "0440e6e97953a70705ef1901cb1267bc80cb69ae7d4ca25010891c5770e989d5",
            },
            ExtraFile {
                url: "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/tokenizer.json",
                target: "lfm2_vl_450m/tokenizer.json",
                sha256: "d3f7877aa8c9ce603604f2cf78c280c24d8b6087c24669610f3391bcd3f703cf",
            },
        ],
    },
    ModelSpec {
        id: 10,
        name: "buffalo_m",
        url: "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_m.zip",
        ml_type: MlType::FaceRecognition,
        unpack: Unpack::Zip,
        target_dir: "face_recognition/models/buffalo_m",
        sha256: "d98264bd8f2dc75cbc2ddce2a14e636e02bb857b3051c234b737bf3b614edca9",
        additional_files: &[],
    },
    ModelSpec {
        id: 11,
        name: "siglip2",
        url: "https://huggingface.co/derneuere/librephotos_models/resolve/main/siglip2/vision_model.onnx",
        ml_type: MlType::Tagging,
        unpack: Unpack::None,
        target_dir: "siglip2/vision_model.onnx",
        sha256: "49ae4958b1098ca995e929d646f7be05a69c65e6344beae07d58c6598ffc5210",
        additional_files: &[
            ExtraFile {
                url: "https://huggingface.co/derneuere/librephotos_models/resolve/main/siglip2/text_model.onnx",
                target: "siglip2/text_model.onnx",
                sha256: "d28c21c7f12c38b0ec43aacb7ce2228fba6bd6b20641802ef2b29809ece46af8",
            },
            ExtraFile {
                url: "https://huggingface.co/derneuere/librephotos_models/resolve/main/siglip2/tokenizer.model",
                target: "siglip2/tokenizer.model",
                sha256: "61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2",
            },
        ],
    },
    ModelSpec {
        id: 12,
        name: "buffalo_l",
        url: "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip",
        ml_type: MlType::FaceRecognition,
        unpack: Unpack::Zip,
        target_dir: "face_recognition/models/buffalo_l",
        sha256: "80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f",
        additional_files: &[],
    },
    ModelSpec {
        id: 13,
        name: "antelopev2",
        url: "https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip",
        ml_type: MlType::FaceRecognition,
        unpack: Unpack::Zip,
        target_dir: "face_recognition/models/antelopev2",
        sha256: "8e182f14fc6e80b3bfa375b33eb6cff7ee05d8ef7633e738d1c89021dcf0c5c5",
        additional_files: &[],
    },
    ModelSpec {
        id: 14,
        name: "ppocrv6_tiny",
        url: "https://huggingface.co/derneuere/librephotos_models/resolve/main/ppocrv6_tiny.tar.gz?download=true",
        ml_type: MlType::Ocr,
        unpack: Unpack::TarGz,
        target_dir: "ocr/ppocrv6_tiny",
        sha256: "7e534d86a0cb6335c769993f6fd9a29f752b6ed98e93f60808649870baa5440b",
        additional_files: &[],
    },
    ModelSpec {
        id: 15,
        name: "ppocrv6_small",
        url: "https://huggingface.co/derneuere/librephotos_models/resolve/main/ppocrv6_small.tar.gz?download=true",
        ml_type: MlType::Ocr,
        unpack: Unpack::TarGz,
        target_dir: "ocr/ppocrv6_small",
        sha256: "241769eb7750b4a43141a509bee8ac6893517c8b41ec3b5e5c45bdd4fde47c21",
        additional_files: &[],
    },
    ModelSpec {
        id: 16,
        name: "ppocrv6_medium",
        url: "https://huggingface.co/derneuere/librephotos_models/resolve/main/ppocrv6_medium.tar.gz?download=true",
        ml_type: MlType::Ocr,
        unpack: Unpack::TarGz,
        target_dir: "ocr/ppocrv6_medium",
        sha256: "21232b79847cd56d5cae801d3364f95e508b40bb0ce159f31687e63c63959a0b",
        additional_files: &[],
    },
];

pub fn by_name(name: &str) -> Option<&'static ModelSpec> {
    CATALOG.iter().find(|m| m.name == name)
}

/// The site settings that decide which models are needed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Selection {
    pub tagging_model: String,
    pub face_recognition_model: String,
    pub ocr_model: String,
    pub captioning_model: String,
}

/// A selection under which `m` counts as selected (explicit downloads).
pub fn selecting(m: &ModelSpec) -> Selection {
    Selection {
        tagging_model: m.name.into(),
        face_recognition_model: m.name.into(),
        ocr_model: m.name.into(),
        captioning_model: m.name.into(),
    }
}

/// `_is_model_not_selected`.
pub fn not_selected(value: &str) -> bool {
    let v = value.trim();
    v.is_empty() || v.eq_ignore_ascii_case("none")
}

/// `_is_model_selected`.
pub fn is_selected(m: &ModelSpec, sel: &Selection) -> bool {
    match m.ml_type {
        // Always kept available: turning captioning on never waits for a download.
        MlType::Captioning => true,
        MlType::Tagging => m.name == sel.tagging_model,
        MlType::FaceRecognition => m.name == sel.face_recognition_model,
        MlType::Ocr => !not_selected(&sel.ocr_model) && m.name == sel.ocr_model,
        MlType::Clip => true,
    }
}

pub fn required(sel: &Selection) -> impl Iterator<Item = &'static ModelSpec> + '_ {
    CATALOG.iter().filter(move |m| is_selected(m, sel))
}

/// Where `name`'s files live: the directory for directory models, the
/// parent directory of the main file for single-file ones.
pub fn model_dir(data_models: &Path, m: &ModelSpec) -> PathBuf {
    let target = data_models.join(m.target_dir);
    match m.unpack {
        Unpack::None => target.parent().map(Path::to_path_buf).unwrap_or(target),
        _ => target,
    }
}

/// `_get_download_target`.
pub fn download_target(data_models: &Path, m: &ModelSpec) -> PathBuf {
    let base = data_models.join(m.target_dir);
    match m.unpack {
        Unpack::TarGz => append_ext(&base, ".tar.gz"),
        Unpack::Zip => append_ext(&base, ".zip"),
        Unpack::None => base,
    }
}

fn append_ext(p: &Path, ext: &str) -> PathBuf {
    let mut s = p.as_os_str().to_os_string();
    s.push(ext);
    PathBuf::from(s)
}

/// `_model_target_exists`.
pub fn target_exists(data_models: &Path, m: &ModelSpec) -> bool {
    let target = data_models.join(m.target_dir);
    if !target.exists() {
        return false;
    }
    if m.ml_type == MlType::FaceRecognition && !dir_has_onnx(&target) {
        return false;
    }
    // A half-extracted tar bundle must not pass for an install.
    if m.ml_type == MlType::Ocr
        && !["det.onnx", "rec.onnx", "charset.txt", "config.json"]
            .iter()
            .all(|f| target.join(f).exists())
    {
        return false;
    }
    m.additional_files
        .iter()
        .all(|f| data_models.join(f.target).exists())
}

fn dir_has_onnx(dir: &Path) -> bool {
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten().any(|e| {
                e.path()
                    .extension()
                    .is_some_and(|x| x.eq_ignore_ascii_case("onnx"))
            })
        })
        .unwrap_or(false)
}

/// `do_all_models_exist`.
pub fn all_required_exist(data_models: &Path, sel: &Selection) -> bool {
    required(sel).all(|m| target_exists(data_models, m))
}

/// `captioning_model_exists`.
pub fn captioning_model_exists(data_models: &Path) -> bool {
    CATALOG
        .iter()
        .filter(|m| m.ml_type == MlType::Captioning)
        .all(|m| target_exists(data_models, m))
}

/// Bytes on disk of an installed model (its directory, or main + extra files).
pub fn size_on_disk(data_models: &Path, m: &ModelSpec) -> u64 {
    fn tree(p: &Path) -> u64 {
        match std::fs::metadata(p) {
            Ok(md) if md.is_dir() => std::fs::read_dir(p)
                .map(|rd| rd.flatten().map(|e| tree(&e.path())).sum())
                .unwrap_or(0),
            Ok(md) => md.len(),
            Err(_) => 0,
        }
    }
    let main = tree(&data_models.join(m.target_dir));
    main + m
        .additional_files
        .iter()
        .map(|f| tree(&data_models.join(f.target)))
        .sum::<u64>()
}

/// `_flatten_wrapper_dir`: lift the files out of a zip's lone top-level
/// folder (antelopev2.zip, buffalo_m.zip) into `target`.
pub fn flatten_wrapper_dir(target: &Path) -> std::io::Result<()> {
    if !target.is_dir() {
        return Ok(());
    }
    let entries: Vec<_> = std::fs::read_dir(target)?.flatten().collect();
    if entries.len() != 1 || !entries[0].path().is_dir() {
        return Ok(());
    }
    let name = entries[0].file_name();
    let wrapper = target.join(format!(".{}.unwrap", name.to_string_lossy()));
    std::fs::rename(entries[0].path(), &wrapper)?;
    for child in std::fs::read_dir(&wrapper)?.flatten() {
        std::fs::rename(child.path(), target.join(child.file_name()))?;
    }
    std::fs::remove_dir(&wrapper)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    NotSelected,
    AlreadyPresent,
    Downloaded,
}

/// `MODEL_DOWNLOAD = (10, 60)`: connect budget, and the longest silence
/// between two chunks before the transfer counts as stalled.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// The HTTP client downloads use (redirects followed, no overall timeout).
pub fn http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
}

/// `download_model`: fetch, verify and unpack one model unless it is not
/// selected or already installed.
pub async fn download_model(
    http: &reqwest::Client,
    data_models: &Path,
    m: &ModelSpec,
    sel: &Selection,
) -> anyhow::Result<Outcome> {
    if !is_selected(m, sel) {
        tracing::info!(model = m.name, "skipping unselected model");
        return Ok(Outcome::NotSelected);
    }
    if m.unpack == Unpack::Zip {
        // Repairs installs unpacked before wrapper folders were flattened.
        let _ = flatten_wrapper_dir(&data_models.join(m.target_dir));
    }
    if target_exists(data_models, m) {
        tracing::info!(model = m.name, "model already downloaded");
        return Ok(Outcome::AlreadyPresent);
    }
    tracing::info!(model = m.name, "downloading model");
    let target = download_target(data_models, m);
    download_file(http, m.url, &target, m.name, Some(m.sha256)).await?;
    if m.unpack != Unpack::None {
        let (archive, root, spec) = (target.clone(), data_models.to_path_buf(), *m);
        let res = tokio::task::spawn_blocking(move || unpack_archive(&archive, &root, &spec)).await;
        // A corrupt archive left behind is never useful.
        let _ = std::fs::remove_file(&target);
        res??;
    }
    for f in m.additional_files {
        let t = data_models.join(f.target);
        if t.exists() {
            continue;
        }
        download_file(
            http,
            f.url,
            &t,
            &format!("{} ({})", m.name, f.target),
            Some(f.sha256),
        )
        .await?;
    }
    Ok(Outcome::Downloaded)
}

/// `_unpack_archive`: a `.tar.gz` into the data_models root, a `.zip` into
/// the model's directory (wrapper folder flattened).
pub fn unpack_archive(archive: &Path, data_models: &Path, m: &ModelSpec) -> anyhow::Result<()> {
    match m.unpack {
        Unpack::None => Ok(()),
        Unpack::TarGz => {
            let f = std::fs::File::open(archive)?;
            let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(f));
            // unpack() refuses entries that would land outside the root.
            tar.unpack(data_models)
                .with_context(|| format!("extracting {}", archive.display()))
        }
        Unpack::Zip => {
            let target = data_models.join(m.target_dir);
            std::fs::create_dir_all(&target)?;
            let f = std::fs::File::open(archive)?;
            let mut zip = zip::ZipArchive::new(f)?;
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i)?;
                let Some(rel) = entry.enclosed_name() else {
                    bail!("unsafe path {:?} in {}", entry.name(), archive.display());
                };
                let out = target.join(rel);
                if entry.is_dir() {
                    std::fs::create_dir_all(&out)?;
                    continue;
                }
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let mut w = std::fs::File::create(&out)?;
                std::io::copy(&mut entry, &mut w)?;
            }
            flatten_wrapper_dir(&target)?;
            Ok(())
        }
    }
}

/// `_download_file`: stream to `<target>.part`, check length and sha256,
/// then rename. Any failure removes the partial file.
pub async fn download_file(
    http: &reqwest::Client,
    url: &str,
    target: &Path,
    name: &str,
    sha256: Option<&str>,
) -> anyhow::Result<()> {
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let partial = append_ext(target, ".part");
    let res = stream_to(http, url, &partial, name, sha256).await;
    match res {
        Ok(()) => {
            tokio::fs::rename(&partial, target).await?;
            Ok(())
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&partial).await;
            Err(e)
        }
    }
}

async fn stream_to(
    http: &reqwest::Client,
    url: &str,
    partial: &Path,
    name: &str,
    sha256: Option<&str>,
) -> anyhow::Result<()> {
    let resp = http
        .get(url)
        .send()
        .await
        .with_context(|| format!("requesting {url}"))?
        .error_for_status()
        .with_context(|| format!("downloading {name}"))?;
    let total = resp.content_length().unwrap_or(0);
    let decoded = resp
        .headers()
        .get(reqwest::header::CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| !v.is_empty() && !v.eq_ignore_ascii_case("identity"));
    let mut file = tokio::fs::File::create(partial).await?;
    let mut hasher = sha256.map(|_| Sha256::new());
    let mut got: u64 = 0;
    let mut last_pct: i64 = -1;
    let mut stream = resp.bytes_stream();
    loop {
        let chunk = match tokio::time::timeout(READ_TIMEOUT, stream.next()).await {
            Err(_) => bail!(
                "download of {name} stalled for {} s",
                READ_TIMEOUT.as_secs()
            ),
            Ok(None) => break,
            Ok(Some(c)) => c.with_context(|| format!("downloading {name}"))?,
        };
        file.write_all(&chunk).await?;
        if let Some(h) = hasher.as_mut() {
            h.update(&chunk);
        }
        got += chunk.len() as u64;
        if let Some(pct) = (got * 100).checked_div(total) {
            let pct = pct as i64;
            if pct != last_pct && pct % 10 == 0 {
                tracing::info!("Downloading {name}: {got}/{total} ({pct}%)");
            }
            last_pct = pct;
        }
    }
    file.flush().await?;
    drop(file);
    if total > 0 && !decoded && got != total {
        bail!("Incomplete download for {name}: got {got} of {total} bytes from {url}");
    }
    if let (Some(h), Some(expected)) = (hasher, sha256) {
        let actual = hex::encode(h.finalize());
        if actual != expected.to_ascii_lowercase() {
            let msg = format!(
                "Checksum mismatch for {name} from {url}: expected sha256 {expected}, got {actual}"
            );
            tracing::error!("{msg}");
            return Err(anyhow!(msg));
        }
    }
    if total == 0 {
        tracing::info!("Downloaded {name}: {got} bytes (size unknown during transfer)");
    }
    Ok(())
}
