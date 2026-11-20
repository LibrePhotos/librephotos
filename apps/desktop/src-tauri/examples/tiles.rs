use std::path::PathBuf;
use std::time::Instant;

use librephotos_viewer_lib::tiles::TileService;
use librephotos_viewer_lib::tiles::geom::{TILE, level_dims};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let all = args.iter().any(|a| a == "--all");
    let path = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(r"C:\Users\Niaz\librephotos\desktop-test-corpus\mixed\photo_1.jpg")
        });
    let root = std::env::temp_dir().join(format!("lpview-tile-bench-{}", std::process::id()));
    let svc = TileService::new(Some(root.clone()), 8 << 30);
    svc.set_fill(args.iter().any(|a| a == "--fill"));
    let t = Instant::now();
    let info = svc.info(&path).expect("info");
    println!(
        "{}: tile_info {:?} in {:.0} ms",
        path.display(),
        info,
        ms(t)
    );
    let Some(info) = info else { return };
    for level in (0..info.levels).rev() {
        let (w, h) = level_dims(info.width, info.height, level);
        let (cols, rows) = (w.div_ceil(TILE), h.div_ceil(TILE));
        let (cx, cy) = (cols / 2, rows / 2);
        let t = Instant::now();
        let r = svc.get(&path, level, cx, cy).expect("tile");
        let first = ms(t);
        let t = Instant::now();
        svc.get(&path, level, cols.saturating_sub(1).min(cx + 1), cy)
            .expect("tile");
        let same_band = ms(t);
        let t = Instant::now();
        svc.get(&path, level, cx, (cy + 1).min(rows - 1))
            .expect("tile");
        let next_band = ms(t);
        println!(
            "level {level} ({w}x{h}, {cols}x{rows} tiles): centre tile {first:.0} ms ({} KB), \
             same band {same_band:.1} ms, next band {next_band:.0} ms",
            r.bytes.len() / 1024
        );
    }
    seams(&svc, &path, &info);
    if all {
        for level in (0..info.levels).rev() {
            let (w, h) = level_dims(info.width, info.height, level);
            let t = Instant::now();
            for y in 0..h.div_ceil(TILE) {
                for x in 0..w.div_ceil(TILE) {
                    svc.get(&path, level, x, y).expect("tile");
                }
            }
            println!("level {level}: every tile in {:.0} ms", ms(t));
        }
    }
    let (n, bytes, disk) = svc.stats();
    println!(
        "memory cache {n} tiles / {} MB, disk {} MB",
        bytes >> 20,
        disk >> 20
    );
    let _ = std::fs::remove_dir_all(&root);
}

fn seams(
    svc: &TileService,
    path: &std::path::Path,
    info: &librephotos_viewer_lib::tiles::TileInfo,
) {
    let get = |x: u32, y: u32| {
        let e = svc.get(path, 0, x, y).expect("tile");
        image::load_from_memory(&e.bytes)
            .expect("decode")
            .into_rgb8()
    };
    let step = |a: &image::Rgb<u8>, b: &image::Rgb<u8>| -> f64 {
        (0..3).map(|c| (a[c] as f64 - b[c] as f64).abs()).sum()
    };
    let (cols, rows) = (info.width.div_ceil(TILE), info.height.div_ceil(TILE));
    let mut acc = [(0.0, 0.0, 0.0); 2];
    let (mut overlap, mut on) = (0.0, 0.0);
    let mut enc = (0.0, 0.0);
    for (x, y) in [
        (cols / 2, rows / 2),
        (cols / 3, rows / 3),
        (cols / 2 - 3, rows / 2 + 2),
    ] {
        let (a, b, c) = (get(x, y), get(x + 1, y), get(x, y + 1));
        let (o, w) = (1u32, TILE);
        for i in o..o + TILE {
            let h = &mut acc[0];
            h.0 += step(a.get_pixel(w, i), b.get_pixel(o, i));
            h.1 += (step(a.get_pixel(o + 255, i), a.get_pixel(o + 256, i))
                + step(b.get_pixel(o + 255, i), b.get_pixel(o + 256, i)))
                / 2.0;
            h.2 += 1.0;
            let v = &mut acc[1];
            v.0 += step(a.get_pixel(i, w), c.get_pixel(i, o));
            v.1 += (step(a.get_pixel(i, o + 255), a.get_pixel(i, o + 256))
                + step(c.get_pixel(i, o + 255), c.get_pixel(i, o + 256)))
                / 2.0;
            v.2 += 1.0;
            enc.0 += step(a.get_pixel(255, i), a.get_pixel(256, i));
            enc.1 += step(a.get_pixel(259, i), a.get_pixel(260, i));
            overlap += step(a.get_pixel(w + 1, i), b.get_pixel(o, i))
                + step(a.get_pixel(w, i), b.get_pixel(0, i));
            on += 2.0;
        }
    }
    println!(
        "re-encoding: step across the tile JPEG's block edges {:.2}, elsewhere {:.2}",
        enc.0 / (on / 2.0),
        enc.1 / (on / 2.0)
    );
    println!(
        "overlap: border pixels differ from the neighbour's own by {:.2} on average",
        overlap / on
    );
    for (name, (edge, near, n)) in ["within a band", "between bands"].iter().zip(acc) {
        println!(
            "seams {name}: step across tile edges {:.2}, across inner block edges {:.2} (ratio {:.2})",
            edge / n,
            near / n,
            edge / near
        );
    }
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}
