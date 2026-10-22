//! Reading site settings. Writes go through [`crate::write::settings::save`].

use lp_core::{Config, SiteSettings};
use sqlx::PgPool;

/// Env-derived defaults overlaid with every stored `site_settings` row.
pub async fn load(pool: &PgPool, config: &Config) -> anyhow::Result<SiteSettings> {
    let mut s = SiteSettings::defaults(config);
    let rows: Vec<(String, serde_json::Value)> =
        sqlx::query_as("SELECT key, value FROM site_settings")
            .fetch_all(pool)
            .await?;
    for (key, value) in rows {
        if !s.apply(&key, &value) {
            tracing::warn!(%key, "ignoring unknown or mistyped site setting");
        }
    }
    Ok(s)
}
