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
    /// Take over a Django-migrated database (at api.0142; 0143/0144 are PostgreSQL no-ops).
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
    /// Create a user (`manage.py createuser`); the password from --password
    /// (or ADMIN_PASSWORD with --admin), generated when missing.
    Createuser {
        username: String,
        email: String,
        /// Password to create/update for the user (generated if omitted).
        #[arg(long)]
        password: Option<String>,
        /// Update an existing user's password (ignoring the email) instead of failing.
        #[arg(long)]
        update: bool,
        /// Create the user with administrative privileges.
        #[arg(long)]
        admin: bool,
    },
    /// Scan every user's scan directory (`manage.py scan`): queues a scan job
    /// per user for the worker (`serve` or `worker`).
    #[command(group(clap::ArgGroup::new("mode").args(["full_scan", "scan_files", "nextcloud"])))]
    Scan {
        /// Run full directory scan.
        #[arg(short = 'f', long)]
        full_scan: bool,
        /// Scan a list of files.
        #[arg(short = 's', long, num_args = 1..)]
        scan_files: Vec<String>,
        /// Run nextcloud scan instead of directory scan.
        #[arg(short = 'n', long)]
        nextcloud: bool,
    },
    /// Save metadata to image files or XMP sidecars (`manage.py save_metadata`).
    #[command(name = "save_metadata", alias = "save-metadata")]
    SaveMetadata {
        /// Which metadata types to write.
        #[arg(long, num_args = 1.., default_values_t = vec!["ratings".to_string()],
              value_parser = ["ratings", "face_tags"])]
        types: Vec<String>,
        /// Only process photos owned by this username.
        #[arg(long)]
        user: Option<String>,
        /// Write to XMP sidecar files (default).
        #[arg(long)]
        sidecar: bool,
        /// Write directly to media files instead of sidecars.
        #[arg(long)]
        media_file: bool,
        /// Only show what would be written, don't actually write.
        #[arg(long)]
        dry_run: bool,
    },
    /// Delete chunked uploads that have already expired (`manage.py delete_expired_uploads`).
    #[command(name = "delete_expired_uploads", alias = "delete-expired-uploads")]
    DeleteExpiredUploads {
        /// Prompt confirmation before each deletion.
        #[arg(long)]
        interactive: bool,
    },
    /// Remove the original photo's metadata (EXIF incl. GPS, XMP, a video's
    /// location) from thumbnails written before it was left out.
    #[command(name = "strip_thumbnail_metadata", alias = "strip-thumbnail-metadata")]
    StripThumbnailMetadata {
        /// Only count the thumbnails that still carry metadata.
        #[arg(long)]
        dry_run: bool,
    },
    /// Fully clear the site-wide cache (a no-op: see CLI.md).
    #[command(name = "clear_cache", alias = "clear-cache")]
    ClearCache,
    /// Queue a similarity index build for every user.
    #[command(name = "build_similarity_index", alias = "build-similarity-index")]
    BuildSimilarityIndex,
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
        Command::ClearCache => {
            lp_server::commands::clear_cache(&mut std::io::stdout())?;
            Ok(())
        }
        Command::Createuser {
            username,
            email,
            password,
            update,
            admin,
        } => {
            let state = lp_server::build_state(config).await?;
            match lp_server::admin::createuser(&state, &username, &email, password, update, admin)
                .await?
            {
                lp_server::admin::Outcome::Created {
                    id,
                    generated_password,
                } => {
                    println!("created user {} (id {id})", username.to_lowercase());
                    if let Some(p) = generated_password {
                        println!("generated password: {p}");
                    }
                }
                lp_server::admin::Outcome::Updated { id } => {
                    println!("updated password of {} (id {id})", username.to_lowercase())
                }
            }
            Ok(())
        }
        Command::Scan {
            full_scan,
            scan_files,
            nextcloud,
        } => {
            let state = lp_server::build_state(config).await?;
            let mode = if nextcloud {
                lp_server::commands::ScanMode::Nextcloud
            } else if !scan_files.is_empty() {
                lp_server::commands::ScanMode::Files(scan_files)
            } else {
                lp_server::commands::ScanMode::Directory { full_scan }
            };
            lp_server::commands::scan(&state, &mode, &mut std::io::stdout()).await?;
            Ok(())
        }
        Command::SaveMetadata {
            types,
            user,
            sidecar: _,
            media_file,
            dry_run,
        } => {
            let state = lp_server::build_state(config).await?;
            let args = lp_server::commands::SaveMetadataArgs {
                types,
                user,
                media_file,
                dry_run,
            };
            lp_server::commands::save_metadata(
                &state,
                &args,
                &mut std::io::stdout(),
                &mut std::io::stderr(),
            )
            .await?;
            Ok(())
        }
        Command::DeleteExpiredUploads { interactive } => {
            let state = lp_server::build_state(config).await?;
            let mut ask = lp_server::commands::ask_yes_no;
            let confirm: Option<&mut dyn FnMut(&str) -> bool> =
                if interactive { Some(&mut ask) } else { None };
            lp_server::commands::delete_expired_uploads(&state, confirm, &mut std::io::stdout())
                .await?;
            Ok(())
        }
        Command::StripThumbnailMetadata { dry_run } => {
            let state = lp_server::build_state(config).await?;
            lp_server::commands::strip_thumbnail_metadata(
                &state,
                dry_run,
                &mut std::io::stdout(),
                &mut std::io::stderr(),
            )
            .await?;
            Ok(())
        }
        Command::BuildSimilarityIndex => {
            let state = lp_server::build_state(config).await?;
            lp_server::commands::build_similarity_index(&state, &mut std::io::stdout()).await?;
            Ok(())
        }
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
