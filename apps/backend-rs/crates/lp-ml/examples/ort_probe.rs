//! Resident memory of a process with ONNX Runtime loaded, with and without a
//! model: `cargo run -p lp-ml --release --example ort_probe -- [model.onnx ...]`
//! (`LP_ORT_LIB` must point at the runtime library).

use std::time::Duration;

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

fn main() -> anyhow::Result<()> {
    let pid = Pid::from_u32(std::process::id());
    let mut sys = System::new();
    println!("baseline                 {:>8.1} MB", rss_mb(&mut sys, pid));

    let info = lp_ml::runtime::init().map_err(|e| anyhow::anyhow!(e))?;
    println!("ORT loaded               {:>8.1} MB", rss_mb(&mut sys, pid));
    println!("  lib       {}", info.lib.display());
    println!("  providers {:?}", info.providers);
    println!(
        "  build     {}",
        info.build_info.lines().next().unwrap_or_default()
    );
    // An environment and a session builder allocate the default thread pools.
    drop(lp_ml::runtime::session_builder()?);
    println!("ORT env + builder        {:>8.1} MB", rss_mb(&mut sys, pid));

    let mut sessions = Vec::new();
    for path in std::env::args().skip(1) {
        let t = std::time::Instant::now();
        let s = lp_ml::runtime::session(std::path::Path::new(&path))?;
        sessions.push(s);
        println!(
            "+ {:<40} {:>8.1} MB  ({:.2} s)",
            std::path::Path::new(&path)
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_default(),
            rss_mb(&mut sys, pid),
            t.elapsed().as_secs_f64()
        );
    }
    if !sessions.is_empty() {
        drop(sessions);
        lp_ml::slot::release_memory();
        std::thread::sleep(Duration::from_millis(200));
        println!("sessions dropped         {:>8.1} MB", rss_mb(&mut sys, pid));
    }
    Ok(())
}
