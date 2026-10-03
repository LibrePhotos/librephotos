//! Read queries and row types for the `stats_admin_stacks_dupes` area:
//! dashboards (`stats`), server/admin stats (`server`), photo stacks
//! (`stacks`), duplicate groups (`dupes`) and the inputs of the stack and
//! duplicate detection jobs (`detect`).

pub mod detect;
pub mod dupes;
pub mod server;
pub mod stacks;
pub mod stats;

/// `api.models.Person.UNKNOWN_PERSON_NAME`.
pub const UNKNOWN_PERSON_NAME: &str = "Unknown - Other";

/// `/media/square_thumbnails_small/<hash>` when the photo has that thumbnail.
pub fn small_thumbnail_url(image_hash: &str, square_small: Option<&str>) -> Option<String> {
    square_small
        .filter(|s| !s.is_empty())
        .map(|_| format!("/media/square_thumbnails_small/{image_hash}"))
}

/// `/media/thumbnails_big/<hash>` when the photo has that thumbnail.
pub fn big_thumbnail_url(image_hash: &str, big: Option<&str>) -> Option<String> {
    big.filter(|s| !s.is_empty())
        .map(|_| format!("/media/thumbnails_big/{image_hash}"))
}

/// `File.get_type_display()`.
pub fn file_type_display(t: i32) -> String {
    match t {
        1 => "Image".into(),
        2 => "Video".into(),
        3 => "Metadata File e.g. XMP".into(),
        4 => "Raw File".into(),
        5 => "Unknown".into(),
        other => other.to_string(),
    }
}
