//! `captions.generate` and the synchronous caption for
//! `/api/photosedit/generateim2txt` (`PhotoCaption.generate_captions_im2txt`).

use lp_core::AppState;
use serde_json::Value;
use uuid::Uuid;

use crate::photos::{self, path_str};
use crate::search_captions;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptionOutcome {
    Generated(String),
    /// Django returns False: feature off, no thumbnail, model "none", or the
    /// sidecar failed (the reason is logged).
    Skipped(&'static str),
}

impl CaptionOutcome {
    pub fn ok(&self) -> bool {
        matches!(self, CaptionOutcome::Generated(_))
    }
}

/// The caption context the user's `llm_settings` allow: (person, place, keywords).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct CaptionContext {
    pub person_name: Option<String>,
    pub location: Option<String>,
    pub add_keywords: bool,
}

/// `PhotoCaption._caption_prompt`.
pub fn caption_prompt(context: Option<&CaptionContext>) -> String {
    let Some(ctx) = context else {
        return "Describe this image in a short, natural image caption.".into();
    };
    let person = match &ctx.person_name {
        Some(name) => format!(
            " The person in the photo is named {name}. Use the name '{name}' directly in the \
             caption \u{2014} do not say 'a person named'. Keep the caption casual and to the \
             point, like a friend tagging a photo."
        ),
        None => String::new(),
    };
    let place = match &ctx.location {
        Some(l) => format!(" This photo was taken at {l}."),
        None => String::new(),
    };
    let keywords = if ctx.add_keywords {
        " Include relevant tags and keywords."
    } else {
        ""
    };
    format!("Write a short, natural image caption.{person}{place}{keywords}")
}

fn flag(settings: &Value, key: &str) -> bool {
    match settings.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
        _ => false,
    }
}

/// `get_or_create` the caption row, then caption the photo. Never errors
/// for a sidecar failure (Django logs it and returns False); database
/// errors propagate.
pub async fn generate_im2txt(state: &AppState, photo_id: Uuid) -> anyhow::Result<CaptionOutcome> {
    let Some(photo) = photos::load_one(&state.db, photo_id).await? else {
        return Ok(CaptionOutcome::Skipped("photo not found"));
    };
    lp_db::sql::query(
        "INSERT INTO api_photo_caption (photo_id, captions_json, created_at, updated_at) \
         VALUES ($1, NULL, now(), now()) ON CONFLICT (photo_id) DO NOTHING",
    )
    .bind(photo_id)
    .execute(&state.db)
    .await?;
    if !state.config.features.image_captioning {
        return Ok(CaptionOutcome::Skipped("image captioning is disabled"));
    }
    let Some(thumb) = photo.thumbnail_path(&state.config.media_root) else {
        return Ok(CaptionOutcome::Skipped("no thumbnail"));
    };
    let settings = state.settings();
    if settings.captioning_model.to_lowercase() == "none" {
        return Ok(CaptionOutcome::Skipped("captioning is disabled"));
    }
    let context = caption_context(state, photo_id, photo.owner_id).await?;
    let prompt = caption_prompt(context.as_ref());
    tracing::info!(%prompt, "caption prompt");
    let image_path = path_str(&thumb);
    let caption = match state
        .ml()
        .caption()
        .generate_caption(&image_path, Some(&prompt))
        .await
    {
        Ok(c) => c
            .replace("<start>", "")
            .replace("<end>", "")
            .trim()
            .to_string(),
        Err(e) => {
            tracing::error!(image = %image_path, error = %e, "could not generate caption");
            return Ok(CaptionOutcome::Skipped("captioning sidecar failed"));
        }
    };

    let mut tx = state.db.begin().await?;
    lp_db::sql::query(
        "UPDATE api_photo_caption SET captions_json = jsonb_set( \
           CASE WHEN jsonb_typeof(captions_json) = 'object' THEN captions_json ELSE '{}'::jsonb END, \
           '{im2txt}', to_jsonb($2::text)), updated_at = now() \
         WHERE photo_id = $1",
    )
    .bind(photo_id)
    .bind(&caption)
    .execute(&mut *tx)
    .await?;
    search_captions::rebuild(&mut tx, &[photo_id], &settings.tagging_model).await?;
    tx.commit().await?;
    tracing::info!(image = %image_path, %caption, "generated caption");
    Ok(CaptionOutcome::Generated(caption))
}

/// `PhotoCaption._caption_context`.
async fn caption_context(
    state: &AppState,
    photo_id: Uuid,
    owner_id: i32,
) -> sqlx::Result<Option<CaptionContext>> {
    let settings: Value =
        lp_db::sql::query_scalar("SELECT llm_settings FROM api_user WHERE id = $1")
            .bind(owner_id)
            .fetch_one(&state.db)
            .await?;
    if !flag(&settings, "enabled") {
        return Ok(None);
    }
    let person_name = if flag(&settings, "add_person") {
        lp_db::sql::query_scalar::<_, String>(
            "SELECT pe.name FROM api_face f JOIN api_person pe ON pe.id = f.person_id \
             WHERE f.photo_id = $1 ORDER BY f.id LIMIT 1",
        )
        .bind(photo_id)
        .fetch_optional(&state.db)
        .await?
    } else {
        None
    };
    let location = if flag(&settings, "add_location") {
        lp_db::sql::query_scalar::<_, Option<String>>(
            "SELECT search_location FROM api_photo_search WHERE photo_id = $1",
        )
        .bind(photo_id)
        .fetch_optional(&state.db)
        .await?
        .flatten()
        .filter(|l| !l.is_empty())
    } else {
        None
    };
    Ok(Some(CaptionContext {
        person_name,
        location,
        add_keywords: flag(&settings, "add_keywords"),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_match_django() {
        assert_eq!(
            caption_prompt(None),
            "Describe this image in a short, natural image caption."
        );
        let ctx = CaptionContext {
            person_name: Some("Anna".into()),
            location: Some("Berlin, Germany".into()),
            add_keywords: true,
        };
        assert_eq!(
            caption_prompt(Some(&ctx)),
            "Write a short, natural image caption. The person in the photo is named Anna. \
             Use the name 'Anna' directly in the caption \u{2014} do not say 'a person named'. \
             Keep the caption casual and to the point, like a friend tagging a photo. \
             This photo was taken at Berlin, Germany. Include relevant tags and keywords."
        );
        assert_eq!(
            caption_prompt(Some(&CaptionContext::default())),
            "Write a short, natural image caption."
        );
    }
}
