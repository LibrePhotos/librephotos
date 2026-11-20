use std::path::{Path, PathBuf};
use std::time::Instant;

use librephotos_viewer_lib::formats::{FileKind, kind_of};
use librephotos_viewer_lib::pipeline::{Key, render_now};
use librephotos_viewer_lib::request::{Kind, THUMB_EDGE};
use librephotos_viewer_lib::{info, jpegmeta, listing, ops};

const CORPUS: &str = r"C:\Users\Niaz\librephotos\desktop-test-corpus";
const HUGE_JPEG: &str = r"C:\Users\Niaz\Pictures\Rot_1.56.1-topaz-enhance-faceai-sharpen.jpg";

fn corpus(sub: &str) -> PathBuf {
    PathBuf::from(CORPUS).join(sub)
}

fn key(p: &Path, kind: Kind, w: u32, h: u32) -> Key {
    Key {
        path: p.to_path_buf(),
        mtime: 0,
        kind,
        w,
        h,
    }
}

fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("lpview-corpus-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
#[ignore]
fn decodes_thumb_and_screen_of_every_corpus_file() {
    let mut failures = Vec::new();
    let mut count = 0;
    for folder in [
        "mixed",
        r"testfiles\raw",
        r"testfiles\video",
        r"testfiles\protected",
    ] {
        let listing = listing::list_folder(corpus(folder).to_str().unwrap()).unwrap();
        for f in &listing.files {
            let p = Path::new(&f.path);
            for (kind, w, h) in [
                (Kind::Thumb, THUMB_EDGE, THUMB_EDGE),
                (Kind::Screen, 2560, 1440),
            ] {
                count += 1;
                let t = Instant::now();
                match render_now(&key(p, kind, w, h)) {
                    Ok(e) if !e.bytes.is_empty() && e.width > 0 && e.height > 0 => {
                        let ms = t.elapsed().as_secs_f64() * 1e3;
                        if kind == Kind::Thumb && e.width.max(e.height) > THUMB_EDGE {
                            failures.push(format!("{} thumb is {}x{}", f.name, e.width, e.height));
                        }
                        if kind == Kind::Screen
                            && (e.width > w || e.height > h)
                            && e.mime != "image/gif"
                        {
                            failures.push(format!("{} screen is {}x{}", f.name, e.width, e.height));
                        }
                        println!(
                            "ok   {kind:?} {} {}x{} {} {:.0} ms",
                            f.name, e.width, e.height, e.mime, ms
                        );
                    }
                    Ok(e) => failures.push(format!(
                        "{} {kind:?}: empty result {}x{}",
                        f.name, e.width, e.height
                    )),
                    Err(e) => failures.push(format!("{} {kind:?}: {e}", f.name)),
                }
            }
        }
    }
    println!("{count} renders, {} failures", failures.len());
    for f in &failures {
        println!("FAIL {f}");
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
#[ignore]
fn listing_filters_and_is_fast() {
    let raw = listing::list_folder(corpus(r"testfiles\raw").to_str().unwrap()).unwrap();
    assert_eq!(raw.files.len(), 55);
    assert!(raw.files.iter().all(|f| f.kind == FileKind::Raw));
    let mixed = listing::list_folder(corpus(r"mixed\orientation_6.jpg").to_str().unwrap()).unwrap();
    assert!(mixed.files.iter().all(|f| f.name != "notes.txt"));
    assert_eq!(mixed.files[mixed.index].name, "orientation_6.jpg");
    let t = Instant::now();
    let big = listing::list_folder(corpus("big").to_str().unwrap()).unwrap();
    let ms = t.elapsed().as_secs_f64() * 1e3;
    println!("listed {} files in {ms:.1} ms", big.files.len());
    assert!(big.files.len() >= 2000);
    assert!(ms < 500.0);
}

#[test]
#[ignore]
fn huge_jpeg_stays_bounded() {
    let p = Path::new(HUGE_JPEG);
    if !p.exists() {
        return;
    }
    for (kind, w, h) in [
        (Kind::Thumb, THUMB_EDGE, THUMB_EDGE),
        (Kind::Screen, 2560, 1440),
    ] {
        let t = Instant::now();
        let e = render_now(&key(p, kind, w, h)).unwrap();
        let ms = t.elapsed().as_secs_f64() * 1e3;
        println!("{kind:?}: {}x{} in {ms:.0} ms", e.width, e.height);
        assert!(e.width <= w && e.height <= h);
        assert!(ms < 5000.0);
    }
}

#[test]
#[ignore]
fn image_info_of_corpus() {
    for folder in ["mixed", r"testfiles\raw"] {
        let listing = listing::list_folder(corpus(folder).to_str().unwrap()).unwrap();
        for f in listing.files.iter().filter(|f| f.kind != FileKind::Video) {
            let i = info::image_info(&f.path).unwrap();
            println!(
                "{} | {} | {:?}x{:?} | {:?} | {:?} {:?} | {:?} | {:?} {:?} iso {:?} {:?} | gps {:?} | {} extra",
                i.name,
                i.format,
                i.width,
                i.height,
                i.taken_at,
                i.camera_make,
                i.camera_model,
                i.lens,
                i.exposure,
                i.f_number,
                i.iso,
                i.focal_length,
                i.gps,
                i.extra.len()
            );
            assert!(i.width.is_some(), "{} has no dimensions", i.name);
        }
    }
    let o6 = info::image_info(corpus(r"mixed\orientation_6.jpg").to_str().unwrap()).unwrap();
    assert_eq!((o6.width, o6.height), (Some(1920), Some(1080)));
    let p = corpus(r"mixed\orientation_6.jpg");
    let e = render_now(&key(&p, Kind::Screen, 800, 800)).unwrap();
    assert_eq!((e.width, e.height), (800, 450));
}

#[test]
#[ignore]
fn rotate_trash_on_copies() {
    let dir = temp_dir("rotate");
    let src = corpus(r"mixed\orientation_6.jpg");
    let p = dir.join("o6.jpg");
    std::fs::copy(&src, &p).unwrap();
    let before = std::fs::read(&p).unwrap();
    let sos = |b: &[u8]| jpegmeta::segments(b).unwrap().last().unwrap().start;
    let o = |p: &Path| {
        jpegmeta::parse_head(&std::fs::read(p).unwrap())
            .unwrap()
            .orientation
    };
    assert_eq!(o(&p), 6);
    let ps = p.to_str().unwrap();
    ops::rotate_file(ps, true).unwrap();
    assert_eq!(o(&p), 3);
    ops::rotate_file(ps, false).unwrap();
    ops::rotate_file(ps, false).unwrap();
    assert_eq!(o(&p), 1);
    ops::rotate_file(ps, true).unwrap();
    let after = std::fs::read(&p).unwrap();
    assert_eq!(o(&p), 6);
    assert_eq!(
        &after[sos(&after)..],
        &before[sos(&before)..],
        "scan data untouched"
    );
    assert!(
        ops::rotate_file(
            corpus(r"mixed\variant.webp")
                .with_file_name("missing.webp")
                .to_str()
                .unwrap(),
            true
        )
        .is_err()
    );

    let q = dir.join("p.jpg");
    std::fs::copy(corpus(r"mixed\photo_10.jpg"), &q).unwrap();
    let mtime = ops::rotate_file(q.to_str().unwrap(), true).unwrap();
    assert!(mtime > 0);
    assert_eq!(o(&q), 6);
    let e = render_now(&key(&q, Kind::Screen, 2560, 1440)).unwrap();
    assert!(e.height > e.width, "rotated screen is portrait");

    let t = dir.join("trash-me.jpg");
    std::fs::copy(&src, &t).unwrap();
    ops::trash_file(t.to_str().unwrap()).unwrap();
    assert!(!t.exists());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
#[ignore]
fn full_kinds() {
    for (p, expect_passthrough) in [
        (corpus(r"mixed\photo_10.jpg"), true),
        (corpus(r"mixed\IMG_6363.heic"), false),
        (corpus(r"testfiles\raw\DSC_2406.NEF"), false),
        (corpus(r"mixed\clip.mp4"), true),
    ] {
        let t = Instant::now();
        let e = render_now(&key(&p, Kind::Full, u32::MAX, u32::MAX)).unwrap();
        let size = std::fs::metadata(&p).unwrap().len() as usize;
        println!(
            "{} full: {}x{} {} in {:.0} ms",
            p.display(),
            e.width,
            e.height,
            e.mime,
            t.elapsed().as_secs_f64() * 1e3
        );
        assert_eq!(e.bytes.len() == size, expect_passthrough);
    }
    assert!(kind_of(Path::new("x.mp4")).is_some());
}

#[test]
#[ignore]
fn clipboard_pixels_are_oriented_and_capped() {
    use librephotos_viewer_lib::decode;
    for (f, landscape) in [
        (r"mixed\orientation_6.jpg", true),
        (r"mixed\IMG_2408.HEIC", false),
        (r"testfiles\raw\228A7079.CR2", false),
        (r"mixed\alpha.png", true),
    ] {
        let t = Instant::now();
        let px = decode::pixels(&corpus(f), ops::CLIPBOARD_EDGE).unwrap();
        println!(
            "{f}: {}x{} {:?} in {:.0} ms",
            px.width,
            px.height,
            px.format,
            t.elapsed().as_secs_f64() * 1e3
        );
        assert!(px.width.max(px.height) <= ops::CLIPBOARD_EDGE);
        assert_eq!(px.width > px.height, landscape, "{f}");
        let n = (px.width * px.height * 4) as usize;
        assert_eq!(px.into_rgba().len(), n);
    }
}
