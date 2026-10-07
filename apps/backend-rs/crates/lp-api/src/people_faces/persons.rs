//! `PersonViewSet` (`/api/persons/`): the people page list, and the rename /
//! cover / delete actions on one person. The queryset is the requester's
//! user-labelled persons, so anyone else's person (or a cluster) is a 404.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::{ApiError, ApiJson, ApiResult, AppState, FieldError, QueryMap};
use lp_db::people_faces::{self as db, PersonRow};
use lp_db::write::people_faces as write;
use serde::Serialize;
use serde_json::Value;

use super::canonical_uri;
use crate::common::{DrfPage, PageRequest};

/// `PersonSerializer` read fields, in its field order.
#[derive(Debug, Serialize)]
pub struct PersonOut {
    pub name: String,
    pub face_url: String,
    pub face_count: i32,
    /// An image hash, despite the name.
    pub face_photo_url: String,
    /// Django answers the string `"False"` when the person has no face on the
    /// requester's photos; the frontend schema wants a boolean.
    pub video: bool,
    pub id: i32,
}

impl From<PersonRow> for PersonOut {
    fn from(r: PersonRow) -> Self {
        let face_url = if r.cover_face_id.is_some() {
            format!("/media/{}", r.cover_face_image.unwrap_or_default())
        } else {
            match r.first_face_image.filter(|i| !i.is_empty()) {
                Some(image) => format!("/media/{image}"),
                None => String::new(),
            }
        };
        let (face_photo_url, video) = match r.cover_photo_hash {
            Some(hash) => (hash, r.cover_photo_video.unwrap_or(false)),
            None => (
                r.first_face_photo_hash.unwrap_or_default(),
                r.first_face_photo_video.unwrap_or(false),
            ),
        };
        PersonOut {
            name: r.name,
            face_url,
            face_count: r.face_count,
            face_photo_url,
            video,
            id: r.id,
        }
    }
}

/// DRF `search_smart_split`: whitespace-separated terms (quotes keep a
/// phrase together), each further split on commas.
fn search_terms(search: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut chars = search
        .replace('\0', "")
        .chars()
        .collect::<Vec<_>>()
        .into_iter()
        .peekable();
    while chars.peek().is_some() {
        while chars.peek().is_some_and(|c| c.is_whitespace()) {
            chars.next();
        }
        let mut term = String::new();
        let mut quote: Option<char> = None;
        while let Some(&c) = chars.peek() {
            if quote.is_none() && c.is_whitespace() {
                break;
            }
            chars.next();
            match quote {
                Some(q) if c == q => quote = None,
                None if c == '"' || c == '\'' => quote = Some(c),
                _ => {}
            }
            term.push(c);
        }
        let term = term.trim_matches(',');
        if term.is_empty() {
            continue;
        }
        let first = term.chars().next().unwrap_or(' ');
        if (first == '"' || first == '\'') && term.len() > 1 && term.ends_with(first) {
            terms.push(term[1..term.len() - 1].to_string());
        } else {
            terms.extend(
                term.split(',')
                    .filter(|s| !s.is_empty())
                    .map(|s| s.trim().to_string()),
            );
        }
    }
    terms
}

/// `GET /api/persons/?page_size=1000` (`StandardResultsSetPagination`:
/// 1000 per page, `page_size` up to 2000), ordered by name.
pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
    uri: Uri,
    q: QueryMap,
) -> ApiResult<Json<DrfPage<PersonOut>>> {
    let search = q.get("search").map(search_terms).unwrap_or_default();
    let mut req = PageRequest::from_query(&q, "page_size", 1000, 2000)?;
    let mut rows = Vec::new();
    let count = if req.page == i64::MAX {
        let count = db::count_persons(&state.db, user.id, &search).await?;
        req = req.valid_for(count)?;
        rows = db::list_persons(&state.db, user.id, &search, req.page_size, req.offset()).await?;
        count
    } else {
        let page =
            db::list_persons(&state.db, user.id, &search, req.page_size, req.offset()).await?;
        match page.first() {
            Some(first) => {
                let count = first.total;
                rows = page;
                count
            }
            None => {
                let count = db::count_persons(&state.db, user.id, &search).await?;
                req = req.valid_for(count)?;
                count
            }
        }
    };
    let results = rows.into_iter().map(PersonOut::from).collect();
    Ok(Json(DrfPage::new(
        &headers,
        &canonical_uri(&uri),
        req,
        count,
        results,
    )))
}

fn parse_id(id: &str) -> ApiResult<i64> {
    id.parse::<i64>().map_err(|_| ApiError::not_found())
}

/// `get_object()`, which runs the list's filters (`?search=`) as well.
async fn load(state: &AppState, user_id: i32, id: &str, q: &QueryMap) -> ApiResult<PersonRow> {
    let id = parse_id(id)?;
    let search = q.get("search").map(search_terms).unwrap_or_default();
    db::person_for_owner(&state.db, user_id, id, &search)
        .await?
        .ok_or_else(|| ApiError::not_found_msg("No Person matches the given query."))
}

/// `GET /api/persons/{id}/`.
pub async fn retrieve(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    q: QueryMap,
) -> ApiResult<Json<PersonOut>> {
    Ok(Json(load(&state, user.id, &id, &q).await?.into()))
}

/// DRF `CharField(max_length)` input rules (trimmed, not blank, not null).
fn drf_char(value: &Value, max_length: usize) -> Result<String, String> {
    let text = match value {
        Value::Null => return Err("This field may not be null.".into()),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return Err("Not a valid string.".into()),
    };
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("This field may not be blank.".into());
    }
    if text.chars().count() > max_length {
        return Err(format!(
            "Ensure this field has no more than {max_length} characters."
        ));
    }
    Ok(text)
}

/// `connection.ops.integer_field_range("IntegerField")`: int4 on Postgres;
/// Django's SQLite backend allows the full 64-bit range.
fn int_field_range(d: lp_db::Dialect) -> (i128, i128) {
    match d {
        lp_db::Dialect::Pg => (i32::MIN.into(), i32::MAX.into()),
        lp_db::Dialect::Sqlite => (i64::MIN.into(), i64::MAX.into()),
    }
}

/// DRF `IntegerField` built from the model's `IntegerField`, with the
/// database backend's range validators.
fn drf_int(value: &Value, (min, max): (i128, i128)) -> Result<i128, String> {
    const INVALID: &str = "A valid integer is required.";
    let text = match value {
        Value::Null => return Err("This field may not be null.".into()),
        Value::Number(n) => n.to_string(),
        Value::String(s) if s.len() > 1000 => return Err("String value too large.".into()),
        Value::String(s) => s.clone(),
        _ => return Err(INVALID.into()),
    };
    // `int(re.sub(r"\.0*\s*$", "", str(data)))`
    let text = text.trim_end();
    let text = match text.rfind('.') {
        Some(dot) if text[dot + 1..].bytes().all(|b| b == b'0') => &text[..dot],
        _ => text,
    };
    let digits = text.trim().replace('_', "");
    let n: i128 = match digits.parse() {
        Ok(n) => n,
        // Python's `int` has no bound: an integer beyond i128 still only
        // fails the range validators.
        Err(_)
            if {
                let d = digits.strip_prefix(['-', '+']).unwrap_or(&digits);
                !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit())
            } =>
        {
            if digits.starts_with('-') {
                i128::MIN
            } else {
                i128::MAX
            }
        }
        Err(_) => return Err(INVALID.to_string()),
    };
    if n > max {
        return Err(format!("Ensure this value is less than or equal to {max}."));
    }
    if n < min {
        return Err(format!(
            "Ensure this value is greater than or equal to {min}."
        ));
    }
    Ok(n)
}

fn py_type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "NoneType",
        Value::Bool(_) => "bool",
        Value::Number(n) if n.is_f64() => "float",
        Value::Number(_) => "int",
        Value::String(_) => "str",
        Value::Array(_) => "list",
        Value::Object(_) => "dict",
    }
}

/// What `PersonSerializer` keeps of a valid body: `name` (the model field;
/// `face_count` is only validated) and the two write-only actions.
struct PersonInput {
    name: Option<String>,
    new_name: Option<String>,
    cover: Option<String>,
}

/// `serializer.is_valid()`, errors in the serializer's field order. Without
/// `partial` (PUT, POST) `name` is required.
fn validate(body: &Value, partial: bool, ints: (i128, i128)) -> ApiResult<PersonInput> {
    let Some(fields) = body.as_object() else {
        return Err(ApiError::validation(format!(
            "Invalid data. Expected a dictionary, but got {}.",
            py_type_name(body)
        )));
    };
    let mut errors = Vec::new();
    let mut check = |key: &str, result: Option<Result<String, String>>| match result {
        Some(Ok(v)) => Some(v),
        Some(Err(message)) => {
            errors.push(FieldError {
                field: key.to_string(),
                message,
            });
            None
        }
        None => None,
    };
    let name = match fields.get("name") {
        None if !partial => check("name", Some(Err("This field is required.".into()))),
        v => check("name", v.map(|v| drf_char(v, 128))),
    };
    check(
        "face_count",
        fields
            .get("face_count")
            .map(|v| drf_int(v, ints).map(|n| n.to_string())),
    );
    let new_name = check(
        "newPersonName",
        fields.get("newPersonName").map(|v| drf_char(v, 100)),
    );
    let cover = check(
        "cover_photo",
        fields.get("cover_photo").map(|v| drf_char(v, 100)),
    );
    if !errors.is_empty() {
        return Err(ApiError::fields(StatusCode::BAD_REQUEST, errors));
    }
    Ok(PersonInput {
        name,
        new_name,
        cover,
    })
}

/// `PATCH /api/persons/{id}/` with `{newPersonName}` (rename) or
/// `{cover_photo}` (an image hash or a photo id of the requester's own).
pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    q: QueryMap,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<PersonOut>> {
    save(&state, user.id, &id, &q, &body, true).await
}

/// `PUT /api/persons/{id}/`: `name` is required and `newPersonName` renames;
/// `cover_photo` is never reached (Django's update returns after the rename).
/// Django also fills an absent `newPersonName` with its "" default and blanks
/// the name; here the name is then left alone.
pub async fn replace(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    q: QueryMap,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<PersonOut>> {
    save(&state, user.id, &id, &q, &body, false).await
}

async fn save(
    state: &AppState,
    user_id: i32,
    id: &str,
    q: &QueryMap,
    body: &Value,
    partial: bool,
) -> ApiResult<Json<PersonOut>> {
    let person = load(state, user_id, id, q).await?;
    let input = validate(body, partial, int_field_range(state.db.dialect()))?;
    if let Some(name) = input.new_name {
        let tagging_model = state.settings().tagging_model.clone();
        write::rename_person(&state.db, person.id, &name, &tagging_model).await?;
    } else if let Some(photo_ref) = input.cover.filter(|_| partial) {
        let photo = db::owned_photo_by_hash_or_id(&state.db, user_id, &photo_ref)
            .await?
            .ok_or_else(|| {
                ApiError::bad_request("cover_photo", format!("Photo not found: {photo_ref}"))
            })?;
        write::set_person_cover(&state.db, person.id, photo).await?;
    } else {
        return Ok(Json(person.into()));
    }
    Ok(Json(load(state, user_id, id, q).await?.into()))
}

/// `POST /api/persons/` `{name}`: the requester's person of that name (any
/// kind), created user-labelled when there is none; 201 either way.
pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let name = validate(&body, false, int_field_range(state.db.dialect()))?
        .name
        .unwrap_or_default();
    let person_id = write::create_person(&state.db, user.id, &name).await?;
    let person = db::owned_person_any_kind(&state.db, user.id, person_id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    Ok((StatusCode::CREATED, Json(PersonOut::from(person))).into_response())
}

/// `DELETE /api/persons/{id}/` (S3: its faces become unlabelled).
pub async fn destroy(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    q: QueryMap,
) -> ApiResult<Response> {
    let person = load(&state, user.id, &id, &q).await?;
    write::delete_person(&state.db, person.id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smart_split() {
        assert_eq!(search_terms("anna  ben"), vec!["anna", "ben"]);
        assert_eq!(search_terms("a,b"), vec!["a", "b"]);
        assert_eq!(search_terms("\"anna m\" x"), vec!["anna m", "x"]);
        assert!(search_terms("  ").is_empty());
    }

    #[test]
    fn int_field() {
        let pg = int_field_range(lp_db::Dialect::Pg);
        let lite = int_field_range(lp_db::Dialect::Sqlite);
        assert_eq!(drf_int(&Value::from(5), pg).unwrap(), 5);
        assert_eq!(drf_int(&Value::from(" 7 "), pg).unwrap(), 7);
        assert_eq!(drf_int(&Value::from("7.00"), pg).unwrap(), 7);
        assert_eq!(drf_int(&Value::from(3.0), pg).unwrap(), 3);
        assert!(drf_int(&Value::from(3.5), pg).is_err());
        assert!(drf_int(&Value::from("abc"), pg).is_err());
        assert!(drf_int(&Value::Bool(true), pg).is_err());
        assert!(drf_int(&Value::from(1i64 << 40), pg).is_err());
        // Django's SQLite backend: the 64-bit range.
        assert_eq!(drf_int(&Value::from(1i64 << 40), lite).unwrap(), 1 << 40);
        assert_eq!(
            drf_int(
                &Value::from("99999999999999999999999999999999999999999"),
                lite
            )
            .unwrap_err(),
            "Ensure this value is less than or equal to 9223372036854775807."
        );
    }

    #[test]
    fn char_field() {
        assert_eq!(drf_char(&Value::from("  Bob "), 100).unwrap(), "Bob");
        assert!(drf_char(&Value::from("  "), 100).is_err());
        assert!(drf_char(&Value::Bool(true), 100).is_err());
        assert_eq!(drf_char(&Value::from(5), 100).unwrap(), "5");
        assert!(drf_char(&Value::from("x".repeat(101)), 100).is_err());
    }
}
