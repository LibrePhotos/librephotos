//! CPU cost per photo of each step of the scan's photo pipeline (round 3),
//! one thread, on a sample of a library: libvips thumbnail (decode +
//! shrink-on-load + resize), WebP saves, the squares, pHash (WebP decode +
//! hash), dominant colour, the RGB readout for inline ML and the ML inputs
//! (MobileCLIP 256 px tensor, SCRFD 640 letterbox resize).
//!
//! ```bash
//! LP_VIPS_LIB=.../libvips-42-....dll VIPS_CONCURRENCY=1 \
//!   cargo run --release -p lp-ingest --example scan_costs -- <dir> [every-nth]
//! ```

use std::path::{Path, PathBuf};
use std::time::Instant;

use lp_ingest::{color, phash, vips};

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out);
        } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("jpg")) {
            out.push(p);
        }
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let dir = PathBuf::from(args.get(1).expect("library dir"));
    let nth: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(40);
    let lib = std::env::var("LP_VIPS_LIB").expect("LP_VIPS_LIB");
    let v = vips::get(Some(Path::new(&lib))).expect("libvips loads");
    let mut files = Vec::new();
    walk(&dir, &mut files);
    files.sort();
    let files: Vec<PathBuf> = files.into_iter().step_by(nth).collect();
    let tmp = std::env::temp_dir().join("lp_scan_costs");
    std::fs::create_dir_all(&tmp)?;
    let mut acc: Vec<(&str, f64)> = Vec::new();
    let mut add = |k: &'static str, t: Instant| {
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        match acc.iter_mut().find(|(n, _)| *n == k) {
            Some((_, v)) => *v += ms,
            None => acc.push((k, ms)),
        }
    };
    let mut same_phash = 0;
    let (mut same_decode, mut max_decode_diff) = (0usize, 0u8);
    for f in &files {
        let t = Instant::now();
        let data = std::fs::read(f)?;
        let _ = md5_hex(&data);
        add("read + md5", t);
        let t = Instant::now();
        let big = v.thumbnail_file(f, 1080).map_err(anyhow::Error::msg)?;
        add("thumbnail_file 1080 (decode+resize)", t);
        let big_path = tmp.join("big.webp");
        let t = Instant::now();
        big.webpsave(&big_path, 95, Some(2))
            .map_err(anyhow::Error::msg)?;
        add("webp big Q95 e2", t);
        let t = Instant::now();
        big.webpsave(&tmp.join("big0.webp"), 95, Some(0))
            .map_err(anyhow::Error::msg)?;
        add("(alt) webp big Q95 e0", t);
        let t = Instant::now();
        let mem = big.copy_memory().map_err(anyhow::Error::msg)?;
        for (h, name) in [(500, "sq.webp"), (250, "sm.webp")] {
            let s = mem.thumbnail_image(h).map_err(anyhow::Error::msg)?;
            s.webpsave(&tmp.join(name), 80, Some(2))
                .map_err(anyhow::Error::msg)?;
        }
        add("squares 500+250 (resize + Q80 e2)", t);
        let t = Instant::now();
        let ph = phash::phash_webp_file(&big_path);
        add("pHash (webp decode + hash)", t);
        let t = Instant::now();
        let wd = std::fs::read(&big_path)?;
        let img = webp::Decoder::new(&wd).decode().expect("webp");
        add("  of which webp decode", t);
        let t = Instant::now();
        let img2 = lp_ml::preprocess::load_rgb(&big_path)?;
        add("  (alt) webp decode, image crate (ML jobs)", t);
        let (mut maxd, mut ndiff) = (0u8, 0usize);
        for (a, b) in img.iter().zip(img2.as_raw().iter()) {
            let d = a.abs_diff(*b);
            maxd = maxd.max(d);
            ndiff += usize::from(d > 0);
        }
        same_decode += usize::from(ndiff == 0 && img.len() == img2.as_raw().len());
        {
            use lp_ml::tags::tagger::{Model, prepare_image, prepare_rgb};
            let (_, a) = prepare_image(Model::MobileClipS2, &big_path)?;
            let (_, kept) = phash::phash_webp_file_keep(&big_path, true);
            let kept = kept.expect("kept rgb");
            let (_, b) = prepare_rgb(Model::MobileClipS2, &kept)?;
            let d = a
                .iter()
                .zip(&b)
                .map(|(x, y)| (x - y).abs())
                .fold(0f32, f32::max);
            if d > 0.0 || kept.dimensions() != img2.dimensions() {
                println!(
                    "  tensor diff {d} dims {:?} vs {:?} for {}",
                    kept.dimensions(),
                    img2.dimensions(),
                    f.display()
                );
            }
        }
        max_decode_diff = max_decode_diff.max(maxd);
        let _ = img;
        let t = Instant::now();
        let _ = color::dominant_webp_file(&tmp.join("sm.webp"));
        add("dominant colour (250 px)", t);
        let t = Instant::now();
        let rgb = big.to_rgb8().expect("rgb");
        add("to_rgb8 (inline ML readout)", t);
        let t = Instant::now();
        let ph_mem = phash::phash_rgb(rgb.as_raw(), 3, rgb.width() as usize, rgb.height() as usize);
        add("(alt) pHash from memory", t);
        same_phash += usize::from(ph.as_deref() == Some(ph_mem.as_str()));
        let t = Instant::now();
        let _ = lp_ml::tags::tagger::prepare_rgb(lp_ml::tags::tagger::Model::MobileClipS2, &rgb)?;
        add("ML: MobileCLIP 256 tensor", t);
        let t = Instant::now();
        let (w, h) = (rgb.width() as usize, rgb.height() as usize);
        let s = 640.0 / w.max(h) as f64;
        let _ = lp_ml::preprocess::cv2::resize_linear(
            rgb.as_raw(),
            w,
            h,
            3,
            (w as f64 * s) as usize,
            (h as f64 * s) as usize,
        );
        add("ML: SCRFD 640 resize", t);
    }
    let n = files.len() as f64;
    println!(
        "{} files (every {nth}th), ms per photo, one thread:",
        files.len()
    );
    for (k, v) in acc {
        println!("  {k:<40} {:7.1}", v / n);
    }
    println!(
        "  pHash from memory == from the WebP: {same_phash}/{}",
        files.len()
    );
    println!(
        "  libwebp decode == image crate decode: {same_decode}/{} (max diff {max_decode_diff})",
        files.len()
    );
    Ok(())
}

fn md5_hex(data: &[u8]) -> String {
    use md5::{Digest, Md5};
    let mut h = Md5::new();
    h.update(data);
    format!("{:x}", h.finalize())
}
