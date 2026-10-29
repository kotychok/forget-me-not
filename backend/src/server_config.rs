//! Explicit HTTP deployment policy. Forwarded headers never select identity or origin.
#[derive(Clone, Debug)]
pub struct HttpAccess {
    pub(crate) origins: Vec<String>,
    pub(crate) authorities: Vec<String>,
    pub(crate) secure: bool,
}
impl HttpAccess {
    pub fn local(backend_port: u16, frontend_port: u16) -> Self {
        let authorities: Vec<_> = [backend_port, frontend_port]
            .into_iter()
            .flat_map(|port| [format!("127.0.0.1:{port}"), format!("localhost:{port}")])
            .collect();
        Self {
            origins: authorities
                .iter()
                .map(|host| format!("http://{host}"))
                .collect(),
            authorities,
            secure: false,
        }
    }
    /// One canonical HTTPS hostname; deliberately excludes credentials, ports and paths.
    pub fn production(origin: &str) -> Result<Self, &'static str> {
        let host = origin
            .strip_prefix("https://")
            .ok_or("FMN_PUBLIC_ORIGIN must use HTTPS")?;
        if host.len() > 253
            || !host.contains('.')
            || host.parse::<std::net::Ipv4Addr>().is_ok()
            || !host.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            })
        {
            return Err(
                "FMN_PUBLIC_ORIGIN must be https:// followed by a lowercase DNS hostname, without a port, path or trailing slash",
            );
        }
        Ok(Self {
            origins: vec![origin.into()],
            authorities: vec![host.into()],
            secure: true,
        })
    }
    pub fn is_production(&self) -> bool {
        self.secure
    }
}
