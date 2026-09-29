//! `stacks.detect`: `batch_detect_stacks` / `detect_burst_sequences`.
//! Existing burst stacks are replaced; hard rules group by EXIF or file name,
//! soft rules by timestamp proximity or visual similarity. All writes happen
//! in one transaction.

use std::collections::HashSet;

use anyhow::Context;
use chrono::{DateTime, Utc};
use indexmap::IndexMap;
use lp_core::AppState;
use lp_db::stats_admin_stacks_dupes::detect::{self, BurstCandidate};
use lp_db::write::stats_admin_stacks_dupes::stacks::{self as write, BURST};
use serde_json::Value;
use sqlx::PgConnection;
use uuid::Uuid;

use super::burst::{self, ExifTags, Rule};
use super::{exif, option_flag, progress};

const STAGE: &str = "burst_sequences";

/// Stacks created (`_create_burst_stack` returning a stack).
struct Stacker<'a> {
    conn: &'a mut PgConnection,
    owner: i32,
    stacked: HashSet<Uuid>,
    created: usize,
}

impl Stacker<'_> {
    /// `_create_burst_stack`: skip photos already in a burst stack.
    async fn create(&mut self, photos: &[&BurstCandidate]) -> anyhow::Result<()> {
        let fresh: Vec<&BurstCandidate> = photos
            .iter()
            .copied()
            .filter(|p| !self.stacked.contains(&p.id))
            .collect();
        if fresh.len() < 2 {
            return Ok(());
        }
        let ids: Vec<Uuid> = fresh.iter().map(|p| p.id).collect();
        let start: Option<DateTime<Utc>> = fresh[0].exif_timestamp;
        let end: Option<DateTime<Utc>> = fresh[fresh.len() - 1].exif_timestamp;
        if write::create_or_merge(self.conn, self.owner, BURST, &ids, start, end)
            .await?
            .is_some()
        {
            self.created += 1;
            self.stacked.extend(ids);
        }
        Ok(())
    }
}

pub async fn detect(
    state: &AppState,
    user_id: i32,
    options: &Value,
    lrj: Option<&str>,
) -> anyhow::Result<usize> {
    if !option_flag(options, "detect_bursts", true) {
        return Ok(0);
    }
    let user = lp_db::users::by_id(&state.db, user_id)
        .await?
        .with_context(|| format!("user {user_id} not found"))?;
    let mut tx = state.db.begin().await?;
    write::clear_type(&mut tx, user_id, BURST).await?;
    let rules = match burst::parse_rules(&user.burst_detection_rules) {
        Ok(r) => r,
        Err(e) => {
            // Django clears the old bursts before it reads the rules.
            tx.commit().await?;
            anyhow::bail!("invalid burst_detection_rules: {e}");
        }
    };
    let hard: Vec<&Rule> = rules.iter().filter(|r| r.is_hard()).collect();
    let soft: Vec<&Rule> = rules.iter().filter(|r| r.is_soft()).collect();
    let mut stacker = Stacker {
        conn: &mut tx,
        owner: user_id,
        stacked: HashSet::new(),
        created: 0,
    };
    if !hard.is_empty() {
        hard_criteria(state, user_id, &hard, &mut stacker, lrj).await?;
    }
    if !soft.is_empty() {
        soft_criteria(user_id, &soft, &mut stacker).await?;
    }
    let created = stacker.created;
    tx.commit().await?;
    Ok(created)
}

async fn hard_criteria(
    state: &AppState,
    user_id: i32,
    rules: &[&Rule],
    stacker: &mut Stacker<'_>,
    lrj: Option<&str>,
) -> anyhow::Result<()> {
    let photos = detect::burst_hard_candidates(stacker.conn, user_id).await?;
    let total = photos.len();
    if total == 0 {
        return Ok(());
    }
    progress(state, lrj, STAGE, 0, total, 0).await;
    let mut tags: Vec<String> = Vec::new();
    for t in rules.iter().flat_map(|r| r.required_exif_tags()) {
        if !tags.contains(&t) {
            tags.push(t);
        }
    }
    let paths: Vec<String> = photos
        .iter()
        .filter_map(|p| p.main_file_path.clone())
        .collect();
    let values = exif::read_tags(
        &state.config.binaries.exiftool,
        &paths,
        &tags,
        (state.config.cores / 2).max(1),
    )
    .await;
    let mut groups: IndexMap<String, Vec<&BurstCandidate>> = IndexMap::new();
    for p in &photos {
        let Some(path) = &p.main_file_path else {
            continue;
        };
        let exif_tags: ExifTags = match values.get(path) {
            Some(v) => tags.iter().cloned().zip(v.iter().cloned()).collect(),
            None => ExifTags::new(),
        };
        for rule in rules {
            if let (true, Some(key)) = rule.is_burst_photo(p, &exif_tags) {
                groups.entry(key).or_default().push(p);
                break;
            }
        }
    }
    progress(state, lrj, STAGE, total, total, groups.len()).await;
    for (_, mut members) in groups {
        if members.len() >= 2 {
            members.sort_by_key(|p| p.exif_timestamp.unwrap_or(p.added_on));
            stacker.create(&members).await?;
        }
    }
    Ok(())
}

fn number(rule: &Rule, key: &str, default: f64) -> f64 {
    rule.params
        .get(key)
        .and_then(|v| v.as_f64().or_else(|| v.as_bool().map(|b| b as i64 as f64)))
        .unwrap_or(default)
}

async fn soft_criteria(
    user_id: i32,
    rules: &[&Rule],
    stacker: &mut Stacker<'_>,
) -> anyhow::Result<()> {
    let photos = detect::burst_soft_candidates(stacker.conn, user_id).await?;
    if photos.len() < 2 {
        return Ok(());
    }
    let refs: Vec<&BurstCandidate> = photos.iter().collect();
    for rule in rules {
        let groups = match rule.rule_type.as_str() {
            "timestamp_proximity" => burst::group_by_timestamp(
                &refs,
                number(rule, "interval_ms", 2000.0),
                option_flag(
                    &Value::Object(rule.params.clone()),
                    "require_same_camera",
                    true,
                ),
            ),
            "visual_similarity" => burst::group_by_visual(
                &refs,
                number(rule, "similarity_threshold", 15.0).floor() as i64,
            ),
            _ => continue,
        };
        for group in groups {
            let members: Vec<&BurstCandidate> = group.iter().map(|&i| refs[i]).collect();
            stacker.create(&members).await?;
        }
    }
    Ok(())
}
