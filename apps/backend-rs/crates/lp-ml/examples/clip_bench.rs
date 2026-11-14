//! CLIP + similarity throughput and memory, in-process:
//! `cargo run -p lp-ml --release --example clip_bench -- [images_dir] [index_size]`
//! (`LP_ORT_LIB` set; models from `lp_ml::golden::data_models()`). Images
//! default to the fixture's big thumbnails; the index is synthetic.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use lp_ml::{Ml, MlConfig, Mode, Service};
use lp_sidecars::{Sidecars, SimilarityBuild};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

fn rss_mb(sys: &mut System, pid: Pid) -> f64 {
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );
    sys.process(pid)
        .map_or(0.0, |p| p.memory() as f64 / 1_048_576.0)
}

fn images(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .expect("images dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                matches!(
                    e.to_ascii_lowercase().as_str(),
                    "webp" | "jpg" | "jpeg" | "png"
                )
            })
        })
        .map(|p| p.display().to_string())
        .collect();
    v.sort();
    v
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = args.first().map(PathBuf::from).unwrap_or_else(|| {
        lp_ml::golden::ml_root().join("../fixture/protected_media/thumbnails_big")
    });
    let index_size: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(100_000);
    let pid = Pid::from_u32(std::process::id());
    let mut sys = System::new();

    let tmp = tempfile::tempdir()?;
    let ml = Ml::new(
        MlConfig::from_env(tmp.path().to_path_buf()),
        Arc::new(lp_ml::Selection::default),
    );
    ml.set_mode(Service::Clip, Mode::InProcess);
    ml.set_mode(Service::Similarity, Mode::InProcess);
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let view = ml.view(&sidecars);
    let model = lp_ml::golden::data_models()
        .join("clip_vit_b32")
        .display()
        .to_string();
    let imgs = images(&dir);
    println!("{} images from {}", imgs.len(), dir.display());

    let base = rss_mb(&mut sys, pid);
    lp_ml::runtime::init().map_err(|e| anyhow::anyhow!(e))?;
    let ort = rss_mb(&mut sys, pid);
    println!("RSS baseline {base:.0} MB, ORT loaded {ort:.0} MB");

    let t = Instant::now();
    view.clip().query_embedding("warm up", &model).await?;
    let loaded = rss_mb(&mut sys, pid);
    println!(
        "model load + first query {:.2}s; RSS {loaded:.0} MB (+{:.0} MB for the model)",
        t.elapsed().as_secs_f64(),
        loaded - ort
    );

    // Image embeddings in the job's 64-photo requests.
    let mut peak = loaded;
    let rounds = 3;
    let t = Instant::now();
    let mut n = 0;
    for _ in 0..rounds {
        for chunk in imgs.chunks(64) {
            let r = view.clip().image_embeddings(chunk, &model).await?;
            n += r.imgs_emb.iter().filter(|e| e.is_some()).count();
            peak = peak.max(rss_mb(&mut sys, pid));
        }
    }
    let secs = t.elapsed().as_secs_f64();
    println!(
        "images: {n} in {secs:.2}s = {:.1} ms/image ({:.1} images/s); peak RSS {peak:.0} MB",
        secs * 1000.0 / n as f64,
        n as f64 / secs
    );

    let queries = [
        "dog",
        "sunset at the beach",
        "people at a birthday party",
        "snow",
    ];
    let t = Instant::now();
    let reps = 25;
    for _ in 0..reps {
        for q in queries {
            view.clip().query_embedding(q, &model).await?;
        }
    }
    let per = t.elapsed().as_secs_f64() * 1000.0 / (reps * queries.len()) as f64;
    println!("text query: {per:.2} ms");
    let after_clip = rss_mb(&mut sys, pid);

    // Similarity: a synthetic index of `index_size` vectors.
    let dim = lp_ml::similarity::EMBEDDING_SIZE;
    let mut x: u64 = 0x9E3779B97F4A7C15;
    let mut rnd = || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        ((x >> 40) as f32 / (1u64 << 24) as f32 - 0.5) * 0.9
    };
    let hashes: Vec<String> = (0..index_size).map(|i| format!("{i:032x}1")).collect();
    let embs: Vec<Vec<f32>> = (0..index_size)
        .map(|_| (0..dim).map(|_| rnd()).collect())
        .collect();
    let t = Instant::now();
    let pages = index_size.div_ceil(5000).max(1);
    for p in 0..pages {
        let (lo, hi) = (p * 5000, ((p + 1) * 5000).min(index_size));
        view.similarity()
            .build(&SimilarityBuild {
                user_id: 1,
                image_hashes: &hashes[lo..hi],
                image_embeddings: &embs[lo..hi],
                begin: p == 0,
                commit: p + 1 == pages,
            })
            .await?;
    }
    println!(
        "index build of {index_size} (5000-vector pages, write to disk) {:.2}s",
        t.elapsed().as_secs_f64()
    );
    drop(embs);
    let q: Vec<f32> = (0..dim).map(|_| rnd()).collect();
    view.similarity().search(1, &q, Some(100), 27.0).await?;
    let t = Instant::now();
    let reps = 50;
    for _ in 0..reps {
        view.similarity().search(1, &q, Some(100), 0.0).await?;
    }
    println!(
        "search over {index_size}: {:.2} ms",
        t.elapsed().as_secs_f64() * 1000.0 / reps as f64
    );
    // A fresh process: only the index file read on first search.
    let ml2 = Ml::new(
        MlConfig::from_env(tmp.path().to_path_buf()),
        Arc::new(lp_ml::Selection::default),
    );
    ml2.set_mode(Service::Similarity, Mode::InProcess);
    let before = rss_mb(&mut sys, pid);
    let t = Instant::now();
    ml2.view(&sidecars)
        .similarity()
        .search(1, &q, Some(100), 0.0)
        .await?;
    println!(
        "cold load of the index + search {:.1} ms; RSS +{:.0} MB (index file {:.0} MB); RSS after CLIP {after_clip:.0} MB",
        t.elapsed().as_secs_f64() * 1000.0,
        rss_mb(&mut sys, pid) - before,
        std::fs::metadata(tmp.path().join("similarity/1.f32"))?.len() as f64 / 1_048_576.0
    );
    Ok(())
}
