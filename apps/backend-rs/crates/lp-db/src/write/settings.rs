//! Site settings writes.

use std::sync::Arc;

use lp_core::settings::constance_encode;
use lp_core::{AppState, SiteSettings};
use serde_json::Value;

/// Store `changes` (constance key names, e.g. `ALLOW_UPLOAD`), mirror them
/// into `constance_constance` when that table exists so Django sees them
/// too, then reload `state.settings`.
pub async fn save(
    state: &AppState,
    changes: &[(&str, Value)],
) -> anyhow::Result<Arc<SiteSettings>> {
    let mut probe = SiteSettings::defaults(&state.config);
    for (key, value) in changes {
        if !probe.apply(key, value) {
            anyhow::bail!("invalid site setting {key} = {value}");
        }
    }
    let mut tx = state.db.begin().await?;
    let has_constance = crate::migrate::table_exists(&mut *tx, "constance_constance").await?;
    for (key, value) in changes {
        crate::sql::query(
            "INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, now()) \
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
        )
        .bind(key)
        .bind(value)
        .execute(&mut *tx)
        .await?;
        if has_constance {
            crate::sql::query(
                "INSERT INTO constance_constance (key, value) VALUES ($1, $2) \
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            )
            .bind(key)
            .bind(constance_encode(value))
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    let fresh = Arc::new(crate::settings::load(&state.db, &state.config).await?);
    state.settings.store(fresh.clone());
    Ok(fresh)
}
