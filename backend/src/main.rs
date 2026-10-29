use forget_me_not::{Store, app, authenticated_app};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = PathBuf::from(
        std::env::var("FMN_DB_PATH").unwrap_or_else(|_| "data/forget-me-not.sqlite".into()),
    );
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| {
        ["--backup", "--verify-backup", "--restore-backup"].contains(&arg.as_str())
    }) {
        if args.len() > 2 {
            return Err("Expected one backup filename".into());
        }
        let file = args
            .get(1)
            .cloned()
            .or_else(|| std::env::var("FMN_BACKUP_FILE").ok())
            .filter(|value| !value.is_empty())
            .ok_or("Provide FILE=path or a backup filename")?;
        let report = match args[0].as_str() {
            "--backup" => {
                forget_me_not::maintenance::backup(&path, std::path::Path::new(&file)).await?
            }
            "--restore-backup" => {
                forget_me_not::maintenance::restore(std::path::Path::new(&file), &path).await?
            }
            _ => forget_me_not::maintenance::verify(std::path::Path::new(&file)).await?,
        };
        println!("{}", serde_json::to_string(&report)?);
        return Ok(());
    }
    let store = Store::open(&path).await?;
    if args
        .first()
        .is_some_and(|arg| arg == "--bootstrap-local-admin" || arg == "--reset-admin-password")
    {
        let login = args
            .get(1)
            .ok_or("Provide a login after the admin command")?;
        if forget_me_not::auth::normalized_login(login).is_none() {
            return Err(
                "Login must contain 3–64 ASCII letters, digits, dots, underscores or hyphens"
                    .into(),
            );
        }
        let reset = args[0] == "--reset-admin-password";
        if args.len() > 3 || args.get(2).is_some_and(|arg| arg != "--password-stdin") {
            return Err("Unknown administrator command argument".into());
        }
        println!(
            "Configuring credentials for existing local owner {}. Lists keep their ownership.",
            store.owner_id
        );
        let password = if args.get(2).is_some_and(|arg| arg == "--password-stdin") {
            use std::io::BufRead;
            let mut password = String::new();
            std::io::stdin().lock().read_line(&mut password)?;
            if password.ends_with('\n') {
                password.pop();
                if password.ends_with('\r') {
                    password.pop();
                }
            }
            password
        } else {
            let password = rpassword::prompt_password("New password (12+ characters): ")?;
            let confirm = rpassword::prompt_password("Repeat password: ")?;
            if password != confirm {
                return Err("Passwords do not match".into());
            }
            password
        };
        forget_me_not::auth::bootstrap(&store, login, password, reset).await?;
        println!("Administrator credentials configured; previous sessions revoked.");
        store.pool.close().await;
        return Ok(());
    }
    if args == ["--migrate"] {
        println!("Migrations applied; local identity provisioned.");
        store.pool.close().await;
        return Ok(());
    }
    if !args.is_empty() {
        return Err("Unknown command arguments".into());
    }
    let port: u16 = std::env::var("FMN_PORT")
        .unwrap_or_else(|_| "3001".into())
        .parse()?;
    let frontend_port: u16 = std::env::var("FMN_FRONTEND_PORT")
        .unwrap_or_else(|_| "5173".into())
        .parse()?;
    let assets =
        PathBuf::from(std::env::var("FMN_ASSETS_PATH").unwrap_or_else(|_| "frontend/dist".into()));
    let mode = std::env::var("FMN_AUTH_MODE").unwrap_or_else(|_| "password".into());
    let router = match mode.as_str() {
        "password" => authenticated_app(store.clone(), port, frontend_port, &assets)
            .await
            .map_err(|_| "Authentication initialization failed")?,
        "local" => {
            let configured = forget_me_not::auth::configured(&store.pool).await?;
            if configured {
                return Err(
                    "Local bypass is forbidden after accounts are configured; use password mode"
                        .into(),
                );
            }
            app(store.clone(), port, frontend_port, &assets)
        }
        _ => return Err("FMN_AUTH_MODE must be password or local".into()),
    };
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    println!("Loopback server: http://127.0.0.1:{port} (access mode: {mode})");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    store.pool.close().await;
    Ok(())
}
