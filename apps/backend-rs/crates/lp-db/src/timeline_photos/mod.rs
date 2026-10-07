//! Read queries and row types for the `timeline_photos` area (owned by that area).
//!
//! * [`date_albums`] - `/albums/date/list/` and `/albums/date/{id}` (the hot path).
//! * [`lists`] - `/photos/recentlyadded/`, `/photos/notimestamp/`.
//! * [`memories`] - `/memories`.
//! * [`detail`] - `GET /photos/{hash|uuid}/` and `/photos/{h}/albums/`.
//! * [`metadata`] - `GET /photos/{id}/metadata` (the write half is in
//!   `lp_db::write::timeline_photos`).

use crate::db::Qb;
pub mod date_albums;
pub mod detail;
pub mod lists;
pub mod memories;
pub mod metadata;

/// `_get_photo_filter_kwargs`: 36 chars with four hyphens that Python's
/// `uuid.UUID` accepts look up `pk`, anything else `image_hash`. Python drops
/// the hyphens wherever they sit, so only the 32 hex digits left count.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PhotoLookup {
    Id(uuid::Uuid),
    Hash(String),
}

impl PhotoLookup {
    pub fn parse(raw: &str) -> Self {
        if raw.chars().count() == 36 && raw.matches('-').count() == 4 {
            let hex: String = raw.chars().filter(|c| *c != '-').collect();
            if hex.bytes().all(|b| b.is_ascii_hexdigit())
                && let Ok(id) = uuid::Uuid::parse_str(&hex)
            {
                return PhotoLookup::Id(id);
            }
        }
        PhotoLookup::Hash(raw.to_string())
    }

    /// Pushes `(p.id = $x)` or `(p.image_hash = $x)`.
    pub fn push(&self, qb: &mut Qb<'_>, p: &str) {
        match self {
            PhotoLookup::Id(id) => {
                qb.push(format!("({p}.id = "));
                qb.push_bind(*id);
            }
            PhotoLookup::Hash(h) => {
                qb.push(format!("({p}.image_hash = "));
                qb.push_bind(h.clone());
            }
        }
        qb.push(")");
    }
}

/// Django `FieldFile.url` for a stored name under `MEDIA_URL = "/media/"`
/// (`filepath_to_uri`: backslashes become slashes, then URL-quoted).
pub fn media_url(name: &str) -> String {
    const SAFE: &[u8] = b"/~!*()'-_.";
    let mut out = String::with_capacity(name.len() + 7);
    out.push_str("/media/");
    for b in name.replace('\\', "/").bytes() {
        if b.is_ascii_alphanumeric() || SAFE.contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_kinds() {
        let id = "123e4567-e89b-12d3-a456-426614174000";
        assert!(matches!(PhotoLookup::parse(id), PhotoLookup::Id(_)));
        assert!(matches!(
            PhotoLookup::parse("123e4567e89b12d3a456426614174000"),
            PhotoLookup::Hash(_)
        ));
        assert!(matches!(
            PhotoLookup::parse("zzze4567-e89b-12d3-a456-426614174000"),
            PhotoLookup::Hash(_)
        ));
        assert_eq!(
            PhotoLookup::parse("123e4567e89b-12d3-a456-4266-14174000"),
            PhotoLookup::parse(id)
        );
    }

    #[test]
    fn media_urls() {
        assert_eq!(
            media_url("thumbnails_big\\abc1.webp"),
            "/media/thumbnails_big/abc1.webp"
        );
        assert_eq!(media_url("faces/a b.jpg"), "/media/faces/a%20b.jpg");
    }
}
