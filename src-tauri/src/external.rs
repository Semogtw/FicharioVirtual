use serde::Deserialize;
use tauri::{AppHandle, Url};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOAuthUrlRequest {
    pub url: String,
}

fn validate_google_oauth_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "URL de autorização inválida")?;
    if url.scheme() != "https"
        || url.host_str() != Some("accounts.google.com")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("URL de autorização inválida".into());
    }
    Ok(url)
}

#[tauri::command]
pub fn open_native_oauth_url(app: AppHandle, request: OpenOAuthUrlRequest) -> Result<(), String> {
    let url = validate_google_oauth_url(&request.url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| format!("Não foi possível abrir o navegador do sistema: {error}"))
}

#[cfg(test)]
mod tests {
    use super::validate_google_oauth_url;

    #[test]
    fn accepts_google_accounts_https_urls() {
        assert!(validate_google_oauth_url(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id=x"
        )
        .is_ok());
    }

    #[test]
    fn rejects_non_google_or_non_https_urls() {
        assert!(validate_google_oauth_url("http://accounts.google.com/o/oauth2/v2/auth").is_err());
        assert!(validate_google_oauth_url("https://accounts.google.com.example.invalid/").is_err());
        assert!(validate_google_oauth_url("https://example.invalid/").is_err());
    }
}
