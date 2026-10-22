//! DRF `PageNumberPagination` envelope: `{count, next, previous, results}`
//! with absolute `next`/`previous` URLs built like DRF's
//! `replace_query_param` / `remove_query_param` (keys sorted, `+` for spaces).

use axum::http::{HeaderMap, Uri};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DrfPage<T: Serialize> {
    pub count: i64,
    pub next: Option<String>,
    pub previous: Option<String>,
    pub results: Vec<T>,
}

/// Parsed `page` / page-size request for a DRF-paginated list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageRequest {
    /// 1-based.
    pub page: i64,
    pub page_size: i64,
}

impl PageRequest {
    /// `page` (default 1; DRF returns 404 "Invalid page." for junk or out of range,
    /// check with [`PageRequest::valid_for`]), `page_size` capped at `max_size`.
    pub fn from_query(
        q: &lp_core::QueryMap,
        size_param: &str,
        default_size: i64,
        max_size: i64,
    ) -> Result<Self, lp_core::ApiError> {
        let page = match q.non_empty("page") {
            None => 1,
            Some("last") => i64::MAX,
            Some(v) => v
                .parse::<i64>()
                .ok()
                .filter(|p| *p >= 1)
                .ok_or_else(|| lp_core::ApiError::not_found_msg("Invalid page."))?,
        };
        let page_size = q
            .int(size_param)
            .filter(|s| *s > 0)
            .map(|s| s.min(max_size))
            .unwrap_or(default_size);
        Ok(PageRequest { page, page_size })
    }

    pub fn num_pages(&self, count: i64) -> i64 {
        if count == 0 {
            1
        } else {
            (count + self.page_size - 1) / self.page_size
        }
    }

    /// Resolves `last` and rejects pages past the end (DRF: 404 "Invalid page.").
    pub fn valid_for(mut self, count: i64) -> Result<Self, lp_core::ApiError> {
        let n = self.num_pages(count);
        if self.page == i64::MAX {
            self.page = n;
        }
        if self.page > n {
            return Err(lp_core::ApiError::not_found_msg("Invalid page."));
        }
        Ok(self)
    }

    /// Saturates for an unresolved `last` (call [`PageRequest::valid_for`] first).
    pub fn offset(&self) -> i64 {
        (self.page - 1).saturating_mul(self.page_size)
    }
}

/// `request.build_absolute_uri()` (scheme http unless `X-Forwarded-Proto: https`).
pub fn absolute_uri(headers: &HeaderMap, uri: &Uri) -> String {
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(axum::http::header::HOST))
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost");
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|h| h.to_str().ok())
        .filter(|s| *s == "https")
        .unwrap_or("http");
    let pq = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    format!("{scheme}://{host}{pq}")
}

fn with_query(url: &str, key: &str, value: Option<&str>) -> String {
    let (base, query) = url.split_once('?').unwrap_or((url, ""));
    let mut pairs: Vec<(String, String)> =
        serde_urlencoded::from_str::<Vec<(String, String)>>(query).unwrap_or_default();
    pairs.retain(|(k, _)| k != key);
    if let Some(v) = value {
        pairs.push((key.to_string(), v.to_string()));
    }
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    let q = serde_urlencoded::to_string(&pairs).unwrap_or_default();
    if q.is_empty() {
        base.to_string()
    } else {
        format!("{base}?{q}")
    }
}

/// DRF `get_next_link` / `get_previous_link` for the current request. The
/// middleware strips the trailing slash before routing, but every Django list
/// URL ends in one, so the links get it back.
pub fn page_links(
    headers: &HeaderMap,
    uri: &Uri,
    page: i64,
    num_pages: i64,
) -> (Option<String>, Option<String>) {
    let mut url = absolute_uri(headers, uri);
    let path_end = url.find('?').unwrap_or(url.len());
    if !url[..path_end].ends_with('/') {
        url.insert(path_end, '/');
    }
    let next = (page < num_pages).then(|| with_query(&url, "page", Some(&(page + 1).to_string())));
    let previous = (page > 1).then(|| {
        if page - 1 == 1 {
            with_query(&url, "page", None)
        } else {
            with_query(&url, "page", Some(&(page - 1).to_string()))
        }
    });
    (next, previous)
}

impl<T: Serialize> DrfPage<T> {
    pub fn new(
        headers: &HeaderMap,
        uri: &Uri,
        req: PageRequest,
        count: i64,
        results: Vec<T>,
    ) -> Self {
        let (next, previous) = page_links(headers, uri, req.page, req.num_pages(count));
        DrfPage {
            count,
            next,
            previous,
            results,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_like_drf() {
        let mut h = HeaderMap::new();
        h.insert("host", "example.com".parse().unwrap());
        let uri: Uri = "/api/jobs/?page_size=10&page=2&mine=true".parse().unwrap();
        let (next, prev) = page_links(&h, &uri, 2, 3);
        assert_eq!(
            next.unwrap(),
            "http://example.com/api/jobs/?mine=true&page=3&page_size=10"
        );
        assert_eq!(
            prev.unwrap(),
            "http://example.com/api/jobs/?mine=true&page_size=10"
        );
        let (next, _) = page_links(&h, &uri, 3, 3);
        assert!(next.is_none());
        let stripped: Uri = "/api/jobs?page=2".parse().unwrap();
        let (next, prev) = page_links(&h, &stripped, 2, 3);
        assert_eq!(next.unwrap(), "http://example.com/api/jobs/?page=3");
        assert_eq!(prev.unwrap(), "http://example.com/api/jobs/");
    }

    #[test]
    fn page_request() {
        let q = lp_core::QueryMap::parse(Some("page=2&page_size=5000"));
        let r = PageRequest::from_query(&q, "page_size", 20, 1000).unwrap();
        assert_eq!((r.page, r.page_size, r.offset()), (2, 1000, 1000));
        assert!(r.valid_for(500).is_err());
        let last = PageRequest::from_query(
            &lp_core::QueryMap::parse(Some("page=last")),
            "page_size",
            20,
            100,
        )
        .unwrap();
        assert_eq!(last.offset(), i64::MAX);
        assert!(
            PageRequest::from_query(
                &lp_core::QueryMap::parse(Some("page=0")),
                "page_size",
                20,
                100
            )
            .is_err()
        );
    }
}
