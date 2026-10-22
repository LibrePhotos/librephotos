//! Django-compatible authentication: simplejwt tokens, Django password
//! hashers, the `AuthUser`/`OptionalUser`/`AdminUser` (header) and
//! `CookieUser`/`CookieOptionalUser` (header or `jwt` cookie) extractors and the
//! token endpoints.

pub mod extract;
pub mod jwt;
pub mod password;
pub mod routes;

pub use extract::{AdminUser, AuthUser, CookieOptionalUser, CookieUser, OptionalUser};
pub use routes::routes;
