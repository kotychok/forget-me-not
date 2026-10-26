use forget_me_not::{Store, app};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = PathBuf::from(
        std::env::var("FMN_DB_PATH").unwrap_or_else(|_| "data/forget-me-not.sqlite".into()),
    );
    let store = Store::open(&path).await?;
    if std::env::args().any(|arg| arg == "--migrate") {
        println!("Migrations applied; local identity provisioned.");
        store.pool.close().await;
        return Ok(());
    }
    let port: u16 = std::env::var("FMN_PORT")
        .unwrap_or_else(|_| "3001".into())
        .parse()?;
    let frontend_port: u16 = std::env::var("FMN_FRONTEND_PORT")
        .unwrap_or_else(|_| "5173".into())
        .parse()?;
    let assets =
        PathBuf::from(std::env::var("FMN_ASSETS_PATH").unwrap_or_else(|_| "frontend/dist".into()));
    let router = app(store.clone(), port, frontend_port, &assets);
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    println!("Local-only server: http://127.0.0.1:{port} (authentication is not enabled)");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    store.pool.close().await;
    Ok(())
}
