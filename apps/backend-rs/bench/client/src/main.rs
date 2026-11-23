//! lpbench: load client for bench/ (W1 endpoint sweeps, W2 journeys, W3 bursts,
//! process-tree stats). Every subcommand prints one JSON document on stdout.

mod burst;
mod check;
mod http;
mod journey;
mod load;
mod procstat;
mod stats;

use std::sync::Arc;
use std::time::Duration;

use clap::{Parser, Subcommand};
use serde_json::json;

#[derive(Parser)]
struct Cli {
    /// Tokio worker threads of the client.
    #[arg(long, default_value_t = 2, global = true)]
    threads: usize,
    /// Pin the client to these CPUs (hex mask, e.g. c00).
    #[arg(long, global = true)]
    affinity: Option<String>,
    #[command(subcommand)]
    cmd: Cmd,
}

fn pids(s: &str) -> Vec<u32> {
    s.split(',').filter_map(|p| p.trim().parse().ok()).collect()
}

#[derive(Subcommand)]
enum Cmd {
    /// Closed loop against one path.
    W1 {
        #[arg(long)]
        base: String,
        #[arg(long)]
        path: String,
        #[arg(long)]
        token: String,
        #[arg(long)]
        concurrency: usize,
        #[arg(long, default_value_t = 3.0)]
        warmup: f64,
        #[arg(long, default_value_t = 20.0)]
        duration: f64,
        /// check.rs `Check` as JSON
        #[arg(long, default_value = "{}")]
        check: String,
        #[arg(long, default_value = "")]
        server_pids: String,
        #[arg(long, default_value = "")]
        pg_pids: String,
        #[arg(long, default_value_t = 60)]
        timeout: u64,
    },
    /// Open-model journeys: a ramp (rate *= factor until a step fails) or a fixed rate.
    Journey {
        #[arg(long)]
        base: String,
        #[arg(long)]
        token: String,
        #[arg(long)]
        user_id: i64,
        #[arg(long)]
        journey: String,
        #[arg(long, default_value = "ramp")]
        mode: String,
        #[arg(long)]
        rate: f64,
        #[arg(long, default_value_t = 1.25)]
        factor: f64,
        #[arg(long, default_value_t = 20)]
        max_steps: usize,
        #[arg(long, default_value_t = 10.0)]
        duration: f64,
        #[arg(long, default_value_t = 30.0)]
        drain: f64,
        #[arg(long, default_value_t = 400)]
        max_inflight: usize,
        #[arg(long, default_value_t = 500.0)]
        p99: f64,
        #[arg(long, default_value = "")]
        server_pids: String,
        #[arg(long, default_value = "")]
        pg_pids: String,
    },
    /// Thumbnail bursts.
    Burst {
        #[arg(long)]
        base: String,
        #[arg(long)]
        token: String,
        #[arg(long, default_value = "square_thumbnails_small")]
        kind: String,
        /// One image hash per line.
        #[arg(long)]
        hashes: String,
        #[arg(long, default_value_t = 200)]
        n: usize,
        #[arg(long, default_value_t = 6)]
        conns: usize,
        #[arg(long, default_value_t = 1)]
        reps: usize,
        /// Index of the first hash (reps continue after it).
        #[arg(long, default_value_t = 0)]
        offset: usize,
    },
    /// CPU seconds and working set of process trees.
    Procstat {
        #[arg(long)]
        pids: String,
        /// Add `detail`: [pid, cpu seconds, working set] per process.
        #[arg(long)]
        detail: bool,
    },
    /// Pin process trees to a CPU mask (hex).
    Pin {
        #[arg(long)]
        pids: String,
        #[arg(long)]
        mask: String,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    if let Some(m) = &cli.affinity {
        procstat::pin_self(usize::from_str_radix(m.trim_start_matches("0x"), 16)?);
    }
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(cli.threads).enable_all().build()?;
    let out = rt.block_on(run(cli.cmd))?;
    println!("{}", serde_json::to_string(&out)?);
    Ok(())
}

async fn run(cmd: Cmd) -> anyhow::Result<serde_json::Value> {
    Ok(match cmd {
        Cmd::W1 { base, path, token, concurrency, warmup, duration, check, server_pids, pg_pids, timeout } => {
            let check: check::Check = serde_json::from_str(&check)?;
            let r = load::run(load::Opts {
                base,
                path,
                token,
                concurrency,
                warmup: Duration::from_secs_f64(warmup),
                duration: Duration::from_secs_f64(duration),
                check,
                server_pids: pids(&server_pids),
                pg_pids: pids(&pg_pids),
                timeout_s: timeout,
            })
            .await;
            serde_json::to_value(r)?
        }
        Cmd::Journey {
            base,
            token,
            user_id,
            journey,
            mode,
            rate,
            factor,
            max_steps,
            duration,
            drain,
            max_inflight,
            p99,
            server_pids,
            pg_pids,
        } => {
            let client = http::client(64, 60);
            let data = journey::discover(&client, &base, &token).await?;
            let discovered = json!({
                "photos": data.photos.len(), "persons": data.persons.len(),
                "user_albums": data.user_albums.len(), "auto_albums": data.auto_albums.len(),
                "thing_albums": data.thing_albums.len(), "place_albums": data.place_albums.len(),
            });
            let env = Arc::new(journey::Env { client: http::client(1024, 60), base, token, user_id, data });
            let o = journey::RunOpts {
                journey: journey.clone(),
                duration: Duration::from_secs_f64(duration),
                drain: Duration::from_secs_f64(drain),
                max_inflight,
                server_pids: pids(&server_pids),
                pg_pids: pids(&pg_pids),
                p99_limit_ms: p99,
            };
            let mut steps = Vec::new();
            let mut max_pass: Option<f64> = None;
            let mut r = rate;
            let n = if mode == "fixed" { 1 } else { max_steps };
            for _ in 0..n {
                let s = journey::run_rate(env.clone(), &o, r).await;
                eprintln!(
                    "{journey} rate {r:.3}/s: p99 {:.1} ms, ok {} failed {} -> {}",
                    s.request_latency.p99_ms,
                    s.journeys_ok,
                    s.journeys_failed,
                    if s.pass { "pass" } else { "FAIL" }
                );
                let pass = s.pass;
                steps.push(s);
                if pass {
                    max_pass = Some(r);
                } else if mode != "fixed" {
                    break;
                }
                r *= factor;
            }
            json!({ "journey": journey, "mode": mode, "discovered": discovered, "max_pass_rate": max_pass, "steps": steps })
        }
        Cmd::Burst { base, token, kind, hashes, n, conns, reps, offset } => {
            let all: Vec<String> =
                std::fs::read_to_string(&hashes)?.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect();
            anyhow::ensure!(!all.is_empty(), "no hashes in {hashes}");
            let mut out = Vec::new();
            for rep in 0..reps {
                let slice: Vec<String> = (0..n).map(|i| all[(offset + rep * n + i) % all.len()].clone()).collect();
                out.push(burst::run(&base, &token, &kind, &slice, conns).await);
            }
            serde_json::to_value(out)?
        }
        Cmd::Procstat { pids: p, detail } => {
            let (stat, per) = procstat::tree_stat_detail(&pids(&p));
            let mut v = serde_json::to_value(stat)?;
            if detail {
                v["detail"] = serde_json::to_value(per)?;
            }
            v
        }
        Cmd::Pin { pids: p, mask } => {
            let m = usize::from_str_radix(mask.trim_start_matches("0x"), 16)?;
            json!({ "pinned": procstat::set_affinity(&pids(&p), m), "mask": mask })
        }
    })
}
