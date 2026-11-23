//! Mapping one file's batched ExifTool output back to the requested tags
//! (`service/exif/main.py` `_attribute`).

use serde_json::{Map, Value};

fn split_tag(tag: &str) -> (String, String) {
    match tag.rfind(':') {
        Some(i) => (tag[..i].to_lowercase(), tag[i + 1..].to_lowercase()),
        None => (String::new(), tag.to_lowercase()),
    }
}

/// ExifTool reports the family 0 group ("XMP") even when a family 1 group
/// ("XMP-dc") was asked for; an ungrouped key (no -G) cannot be checked.
fn group_matches(requested: &str, returned: &str) -> bool {
    requested.is_empty()
        || returned.is_empty()
        || requested == returned
        || requested.starts_with(&format!("{returned}-"))
}

/// "Description-*" asks for every language entry of a lang-alt tag.
fn name_matches(requested: &str, returned: &str) -> bool {
    match requested.strip_suffix('*') {
        Some(prefix) if requested.ends_with("-*") => returned.starts_with(prefix),
        _ => requested == returned,
    }
}

/// Values in tag order (None = unresolved) and whether every returned key
/// was claimed by some requested tag.
pub fn attribute(data: &Map<String, Value>, tags: &[String]) -> (Vec<Option<Value>>, bool) {
    let keys: Vec<(&String, (String, String))> = data
        .keys()
        .filter(|k| k.as_str() != "SourceFile")
        .map(|k| (k, split_tag(k)))
        .collect();
    let mut claimed = vec![false; keys.len()];
    let mut values = Vec::with_capacity(tags.len());
    for tag in tags {
        let (group, name) = split_tag(tag);
        let mut value = None;
        for (i, (key, (key_group, key_name))) in keys.iter().enumerate() {
            if name_matches(&name, key_name) && group_matches(&group, key_group) {
                claimed[i] = true;
                if value.is_none() {
                    value = data.get(*key).cloned();
                }
            }
        }
        values.push(value);
    }
    (values, claimed.iter().all(|c| *c))
}

/// `get_tag`: the first value that is not `SourceFile`.
pub fn first_value(data: &Map<String, Value>) -> Option<Value> {
    data.iter()
        .find(|(k, _)| k.as_str() != "SourceFile")
        .map(|(_, v)| v.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn obj(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn groups_and_lang_alt() {
        let data = obj(json!({
            "SourceFile": "a.jpg",
            "File:FileSize": 10,
            "EXIF:ImageWidth": 800,
            "File:ImageWidth": 801,
            "XMP:Description-de": "Hallo",
            "XMP:Rating": 4
        }));
        let tags: Vec<String> = [
            "File:FileSize",
            "ImageWidth",
            "XMP-dc:Description-*",
            "Rating",
            "EXIF:Model",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let (values, complete) = attribute(&data, &tags);
        assert_eq!(values[0], Some(json!(10)));
        assert_eq!(values[1], Some(json!(800)));
        assert_eq!(values[2], Some(json!("Hallo")));
        assert_eq!(values[3], Some(json!(4)));
        assert_eq!(values[4], None);
        assert!(complete);
    }

    #[test]
    fn unclaimed_key_is_incomplete() {
        let data = obj(json!({"SourceFile": "a", "EXIF:DateTimeOriginal": "x", "EXIF:Other": 1}));
        let (values, complete) = attribute(&data, &["EXIF:DateTimeOriginal".to_string()]);
        assert_eq!(values[0], Some(json!("x")));
        assert!(!complete);
    }

    #[test]
    fn wildcard_does_not_match_x_default() {
        assert!(!name_matches("description-*", "description"));
        assert!(name_matches("description-*", "description-fr"));
        assert!(group_matches("xmp-dc", "xmp"));
        assert!(!group_matches("xmp", "xmp-dc"));
    }
}
