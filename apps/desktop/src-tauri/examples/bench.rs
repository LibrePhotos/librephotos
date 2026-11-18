//! Decode benchmark over the test corpus: thumb / screen (2560x1440) / full per file, cold (no
//! app cache; OS file cache warm after the first read) and cached (LRU hit through the pipeline).
//!
//!     cargo run --example bench -- [--full] [--quick] [paths or folders...]
//!
//! Prints a markdown table per file and a per-format summary (medians).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use librephotos_viewer_lib::formats::{ext_of, kind_of};
use librephotos_viewer_lib::pipeline::{Key, Pipeline, render_now};
use librephotos_viewer_lib::request::{Kind, THUMB_EDGE};

const CORPUS: &str = r"C:\Users\Niaz\librephotos\desktop-test-corpus";

fn default_inputs() -> Vec<PathBuf> {
    let mut v = vec![PathBuf::from(CORPUS).join("mixed")];
    let raw = PathBuf::from(CORPUS).join(r"testfiles\raw");
    for n in [
        "228A7079.CR2",
        "IMG_1811.CR3",
        "IMG_1846.CR3",
        "DSC_2406.NEF",
        "DSC_8714.NEF",
        "PhotoTraces_Free_RAW_Photos_01_Manhattan_Skyline.dng",
        "signature edits free raws DSC_4437.NEF",
    ] {
        v.push(raw.join(n));
    }
    v.push(PathBuf::from(
        r"C:\Users\Niaz\Pictures\Rot_1.56.1-topaz-enhance-faceai-sharpen.jpg",
    ));
    v
}

fn expand(inputs: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for p in inputs {
        if p.is_dir() {
            let mut files: Vec<_> = std::fs::read_dir(p)
                .unwrap()
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| p.is_file() && kind_of(p).is_some())
                .collect();
            files.sort();
            out.extend(files);
        } else if p.is_file() {
            out.push(p.clone());
        } else {
            eprintln!("skipping missing {}", p.display());
        }
    }
    out
}

fn time(key: &Key) -> (f64, String) {
    let t = Instant::now();
    let r = render_now(key);
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    let what = match r {
        Ok(e) => format!(
            "{}x{} {} {}KB",
            e.width,
            e.height,
            e.mime.trim_start_matches("image/"),
            e.bytes.len() / 1024
        ),
        Err(e) => format!("ERR {e}"),
    };
    (ms, what)
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.total_cmp(b));
    if v.is_empty() {
        f64::NAN
    } else {
        v[v.len() / 2]
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let do_full = args.iter().any(|a| a == "--full");
    let inputs: Vec<PathBuf> = args
        .iter()
        .filter(|a| !a.starts_with("--"))
        .map(PathBuf::from)
        .collect();
    let inputs = if inputs.is_empty() {
        default_inputs()
    } else {
        inputs
    };
    let files = expand(&inputs);
    let pipe = Pipeline::new(6, 256 << 20);

    println!(
        "| file | MB | thumb ms | thumb out | screen ms | screen out | cached ms | full ms | full out |"
    );
    println!("|---|---:|---:|---|---:|---|---:|---:|---|");
    let mut by_fmt: BTreeMap<String, [Vec<f64>; 3]> = BTreeMap::new();
    for f in &files {
        let mb = std::fs::metadata(f).map(|m| m.len()).unwrap_or(0) as f64 / 1e6;
        let key = |kind, w, h| Key {
            path: f.clone(),
            mtime: 0,
            kind,
            w,
            h,
        };
        let (tm, tw) = time(&key(Kind::Thumb, THUMB_EDGE, THUMB_EDGE));
        let (sm, sw) = time(&key(Kind::Screen, 2560, 1440));
        // Cached: first get fills the LRU, the second is the hit we time.
        let _ = pipe.get(f.clone(), Kind::Screen, 2560, 1440);
        let t = Instant::now();
        let _ = pipe.get(f.clone(), Kind::Screen, 2560, 1440);
        let cm = t.elapsed().as_secs_f64() * 1000.0;
        let (fm, fw) = if do_full {
            time(&key(Kind::Full, u32::MAX, u32::MAX))
        } else {
            (f64::NAN, "-".into())
        };
        let name = f.file_name().unwrap().to_string_lossy();
        println!(
            "| {name} | {mb:.1} | {tm:.1} | {tw} | {sm:.1} | {sw} | {cm:.2} | {fm:.0} | {fw} |"
        );
        let e = by_fmt.entry(ext_of(Path::new(f))).or_default();
        e[0].push(tm);
        e[1].push(sm);
        if do_full {
            e[2].push(fm);
        }
    }
    println!("\n| format | files | thumb median ms | screen median ms | full median ms |");
    println!("|---|---:|---:|---:|---:|");
    for (fmt, mut v) in by_fmt {
        let n = v[0].len();
        let [a, b, c] = &mut v;
        println!(
            "| {fmt} | {n} | {:.1} | {:.1} | {:.0} |",
            median(a),
            median(b),
            median(c)
        );
    }
}
