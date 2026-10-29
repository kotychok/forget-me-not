use axum_login::AuthnBackend;
use forget_me_not::{
    Store,
    accounts::Error,
    auth::{self, Backend},
};
const PASSWORD: &str = "Synthetic friend password!";
async fn setup() -> (tempfile::TempDir, Store, Backend, auth::User) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("accounts.sqlite"))
        .await
        .unwrap();
    auth::bootstrap(&store, "owner", PASSWORD.into(), false)
        .await
        .unwrap();
    let backend = Backend::new(store.pool.clone()).await.unwrap();
    let actor = backend.get_user(&store.owner_id).await.unwrap().unwrap();
    (dir, store, backend, actor)
}
#[tokio::test]
async fn activation_is_single_use_hashed_and_creates_an_isolated_user() {
    let (_dir, store, backend, actor) = setup().await;
    let own = store.create("Owner private".into()).await.unwrap();
    let issued = backend
        .create_friend(&actor, "Friend", "Friend name")
        .await
        .unwrap();
    assert_eq!(issued.login, "friend");
    assert_eq!(issued.purpose, "activate");
    let rows = backend.admin_accounts(&actor).await.unwrap();
    let friend = rows.iter().find(|u| u.login == "friend").unwrap();
    assert_eq!(friend.status, "pending");
    let id = friend.id.clone();
    assert!(backend.get_user(&id).await.unwrap().is_none());
    let stored: Vec<u8> = sqlx::query_scalar("SELECT digest FROM account_tokens")
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(stored.len(), 32);
    let mut tampered = issued.token.clone();
    let last = tampered.pop().unwrap();
    tampered.push(if last == '0' { '1' } else { '0' });
    assert!(backend.preview_account_link(&tampered).await.is_err());
    assert!(
        backend
            .redeem_account_link(&tampered, PASSWORD.into())
            .await
            .is_err()
    );
    let listing = serde_json::to_string(&rows).unwrap();
    assert!(!listing.contains(&issued.token));
    assert!(!listing.contains("password_hash"));
    assert_eq!(
        backend
            .preview_account_link(&issued.token)
            .await
            .unwrap()
            .login,
        "friend"
    );
    assert_eq!(
        backend
            .preview_account_link(&issued.token)
            .await
            .unwrap()
            .login,
        "friend"
    );
    backend
        .redeem_account_link(&issued.token, PASSWORD.into())
        .await
        .unwrap();
    assert!(backend.preview_account_link(&issued.token).await.is_err());
    assert!(
        backend
            .redeem_account_link(&issued.token, PASSWORD.into())
            .await
            .is_err()
    );
    let friend = backend
        .authenticate(auth::Credentials {
            login: "friend".into(),
            password: PASSWORD.into(),
        })
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        backend.admin_accounts(&friend).await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        backend.create_friend(&friend, "intruder", "Intruder").await,
        Err(Error::Forbidden)
    ));
    let private = Store {
        pool: store.pool.clone(),
        owner_id: friend.user_id,
    };
    assert!(private.lists().await.unwrap().is_empty());
    assert!(private.get(&own.id).await.is_err());
    let audit: i64 = sqlx::query_scalar("SELECT count(*) FROM account_audit")
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(audit, 3);
}
#[tokio::test]
async fn reissue_expiry_disable_and_reset_revoke_prior_access_without_losing_lists() {
    let (_dir, store, backend, actor) = setup().await;
    let first = backend
        .create_friend(&actor, "friend", "Friend")
        .await
        .unwrap();
    let id = backend
        .admin_accounts(&actor)
        .await
        .unwrap()
        .into_iter()
        .find(|u| u.login == "friend")
        .unwrap()
        .id;
    let next = backend.issue_account_link(&actor, &id).await.unwrap();
    assert!(backend.preview_account_link(&first.token).await.is_err());
    backend
        .redeem_account_link(&next.token, PASSWORD.into())
        .await
        .unwrap();
    let friend = backend.get_user(&id).await.unwrap().unwrap();
    let grant = backend.create_grant(&friend).await.unwrap().unwrap();
    let private = Store {
        pool: store.pool.clone(),
        owner_id: id.clone(),
    };
    let list = private.create("Friend private".into()).await.unwrap();
    let reset = backend.issue_account_link(&actor, &id).await.unwrap();
    assert_eq!(reset.purpose, "reset");
    assert!(backend.get_user(&id).await.unwrap().is_none());
    assert!(
        backend
            .touch_grant(&friend, &grant)
            .await
            .unwrap()
            .is_none()
    );
    backend
        .set_account_enabled(&actor, &id, false)
        .await
        .unwrap();
    assert!(backend.preview_account_link(&reset.token).await.is_err());
    backend
        .set_account_enabled(&actor, &id, true)
        .await
        .unwrap();
    assert!(backend.get_user(&id).await.unwrap().is_none());
    let reset = backend.issue_account_link(&actor, &id).await.unwrap();
    sqlx::query("UPDATE account_tokens SET expires_at=0 WHERE id=?")
        .bind(reset.token.split('.').next().unwrap())
        .execute(&store.pool)
        .await
        .unwrap();
    assert!(backend.preview_account_link(&reset.token).await.is_err());
    let reset = backend.issue_account_link(&actor, &id).await.unwrap();
    backend
        .redeem_account_link(&reset.token, "New friend password!".into())
        .await
        .unwrap();
    assert!(
        backend
            .authenticate(auth::Credentials {
                login: "friend".into(),
                password: PASSWORD.into()
            })
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        backend
            .authenticate(auth::Credentials {
                login: "friend".into(),
                password: "New friend password!".into()
            })
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(private.get(&list.id).await.unwrap().title, "Friend private");
}
#[tokio::test]
async fn concurrent_redemption_commits_exactly_one_password_and_bad_password_does_not_consume() {
    let (_dir, _store, backend, actor) = setup().await;
    let issued = backend
        .create_friend(&actor, "friend", "Friend")
        .await
        .unwrap();
    assert!(
        backend
            .redeem_account_link(&issued.token, "short".into())
            .await
            .is_err()
    );
    assert!(backend.preview_account_link(&issued.token).await.is_ok());
    let (a, b) = tokio::join!(
        backend.redeem_account_link(&issued.token, "First candidate password!".into()),
        backend.redeem_account_link(&issued.token, "Second candidate password!".into())
    );
    assert_ne!(a.is_ok(), b.is_ok());
}
#[tokio::test]
async fn authority_self_protection_and_failed_create_are_transactional() {
    let (_dir, store, backend, actor) = setup().await;
    assert!(
        backend
            .set_account_enabled(&actor, &actor.user_id, false)
            .await
            .is_err()
    );
    assert!(
        backend
            .issue_account_link(&actor, &actor.user_id)
            .await
            .is_err()
    );
    backend
        .create_friend(&actor, "friend", "Friend")
        .await
        .unwrap();
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert!(matches!(
        backend.create_friend(&actor, "FRIEND", "Duplicate").await,
        Err(Error::Conflict)
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users")
            .fetch_one(&store.pool)
            .await
            .unwrap(),
        before
    );
    sqlx::query("UPDATE auth_accounts SET auth_version='changed' WHERE user_id=?")
        .bind(&actor.user_id)
        .execute(&store.pool)
        .await
        .unwrap();
    assert!(matches!(
        backend.create_friend(&actor, "other", "Other").await,
        Err(Error::Forbidden)
    ));
}

#[tokio::test]
async fn concurrent_admin_disabling_leaves_an_active_administrator() {
    let (_dir, store, backend, actor) = setup().await;
    let issued = backend
        .create_friend(&actor, "secondadmin", "Second admin")
        .await
        .unwrap();
    backend
        .redeem_account_link(&issued.token, PASSWORD.into())
        .await
        .unwrap();
    sqlx::query("UPDATE auth_accounts SET role='admin' WHERE login='secondadmin'")
        .execute(&store.pool)
        .await
        .unwrap();
    let id: String =
        sqlx::query_scalar("SELECT user_id FROM auth_accounts WHERE login='secondadmin'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
    let other = backend.get_user(&id).await.unwrap().unwrap();
    let (a, b) = tokio::join!(
        backend.set_account_enabled(&actor, &id, false),
        backend.set_account_enabled(&other, &actor.user_id, false)
    );
    assert_ne!(a.is_ok(), b.is_ok());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM auth_accounts WHERE role='admin' AND status='active'"
        )
        .fetch_one(&store.pool)
        .await
        .unwrap(),
        1
    );
}

#[tokio::test]
async fn migration_from_m11_preserves_admin_credentials_content_and_existing_grants() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.sqlite");
    let old = dir.path().join("old");
    std::fs::create_dir(&old).unwrap();
    for file in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations")).unwrap() {
        let file = file.unwrap();
        if file
            .file_name()
            .to_string_lossy()
            .starts_with("20261029000800")
        {
            continue;
        }
        std::fs::copy(file.path(), old.join(file.file_name())).unwrap();
    }
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::migrate::Migrator::new(old.as_path())
        .await
        .unwrap()
        .run(&pool)
        .await
        .unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let list = uuid::Uuid::new_v4().to_string();
    let grant = uuid::Uuid::new_v4().to_string();
    let hash = auth::hash_password(PASSWORD.into()).await.unwrap();
    sqlx::query("INSERT INTO users VALUES (?,'Existing',1)")
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO local_identity VALUES (1,?)")
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO lists VALUES (?,?,'Preserved',0,7,1,2)")
        .bind(&list)
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO auth_accounts VALUES (?,'owner',?,'admin','active','previous-version',2)",
    )
    .bind(&owner)
    .bind(hash)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO auth_grants VALUES (?,?,'previous-version',?,?,?)")
        .bind(&grant)
        .bind(&owner)
        .bind(auth::now())
        .bind(auth::now())
        .bind(auth::now() + 3600)
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let store = Store::open(&path).await.unwrap();
    let backend = Backend::new(store.pool.clone()).await.unwrap();
    let user = backend
        .authenticate(auth::Credentials {
            login: "owner".into(),
            password: PASSWORD.into(),
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(user.user_id, owner);
    assert_eq!(store.get(&list).await.unwrap().revision, 7);
    assert!(backend.touch_grant(&user, &grant).await.unwrap().is_some());
    assert_eq!(
        backend.admin_accounts(&user).await.unwrap()[0].status,
        "active"
    );
    assert!(
        sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&store.pool)
            .await
            .unwrap()
            .is_empty()
    );
}
