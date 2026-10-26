/// Application failures; HTTP status mapping lives in the HTTP adapter.
#[derive(Debug)]
pub enum AppError {
    NotFound,
    Conflict,
    Invalid(&'static str),
    Corrupt(&'static str),
    Storage,
}
pub type Result<T> = std::result::Result<T, AppError>;
pub(crate) fn invalid(message: &'static str) -> AppError {
    AppError::Invalid(message)
}
impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        eprintln!(
            "Database operation failed: {}",
            match error {
                sqlx::Error::Database(_) => "constraint or database error",
                sqlx::Error::PoolTimedOut => "pool timeout",
                _ => "storage error",
            }
        );
        Self::Storage
    }
}
