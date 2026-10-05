use clap::{Parser, Subcommand};
use lp_core::Config;

#[derive(Parser)]
#[command(
    name = "librephotos-rs",
    about = "LibrePhotos backend (experimental Rust port)"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// API + embedded job worker (default).
    Serve {
        /// Skip applying pending Rust migrations at startup.
        #[arg(long)]
        no_migrate: bool,
    },
    /// Job worker only.
    Worker,
    /// Apply pending migrations (fresh DB: baseline + Rust migrations).
    Migrate,
    /// Take over a Django-migrated database (pinned at api.0142).
    Adopt {
        /// Skip the django_migrations check.
        #[arg(long)]
        skip_check: bool,
    },
    /// Create a superuser; password from ADMIN_PASSWORD or generated.
    Createadmin {
        username: String,
        email: String,
        /// Reset the password of an existing user instead of failing.
        #[arg(short, long)]
        update: bool,
    },
    /// List the ML model catalog under MEDIA_ROOT/data_models, or download
    /// models (sha256-verified) without the database or site settings.
    Models {
        /// Download the named models (all of the catalog with `--all`).
        #[arg(long)]
        download: bool,
        #[arg(long)]
        all: bool,
        names: Vec<String>,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let config = Config::from_env()?;
    lp_server::init_tracing(&config);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(config.cores)
        .enable_all()
        .build()?;
    runtime.block_on(run(cli, config))
}

async fn run(cli: Cli, config: Config) -> anyhow::Result<()> {
    match cli.command.unwrap_or(Command::Serve { no_migrate: false }) {
        Command::Serve { no_migrate } => lp_server::serve(config, !no_migrate).await,
        Command::Worker => lp_server::run_worker(config).await,
        Command::Migrate => {
            let pool = lp_db::connect(&config).await?;
            lp_db::migrate::run_checked(&pool).await?;
            println!("migrations applied");
            Ok(())
        }
        Command::Adopt { skip_check } => {
            let pool = lp_db::connect(&config).await?;
            let report = lp_db::adopt::adopt(&pool, skip_check).await?;
            println!(
                "adopted: baseline {}; imported settings: [{}]; skipped: [{}]",
                if report.baseline_marked {
                    "recorded"
                } else {
                    "already recorded"
                },
                report.imported_settings.join(", "),
                report.skipped_settings.join(", ")
            );
            Ok(())
        }
        Command::Models {
            download,
            all,
            names,
        } => lp_server::models_cli(&config, download, all, &names).await,
        Command::Createadmin {
            username,
            email,
            update,
        } => {
            let password = std::env::var("ADMIN_PASSWORD").ok();
            let username = username.to_lowercase();
            let state = lp_server::build_state(config).await?;
            match lp_server::admin::createadmin(&state, &username, &email, password, update).await?
            {
                lp_server::admin::Outcome::Created {
                    id,
                    generated_password,
                } => {
                    println!("created admin {username} (id {id})");
                    if let Some(p) = generated_password {
                        println!("generated password: {p}");
                    }
                }
                lp_server::admin::Outcome::Updated { id } => {
                    println!("updated password of {username} (id {id})")
                }
            }
            Ok(())
        }
    }
}
