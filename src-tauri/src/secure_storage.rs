use serde::Deserialize;
use tauri::AppHandle;

const MAX_KEY_BYTES: usize = 256;
const MAX_VALUE_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStorageKeyRequest {
    pub key: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStorageSetRequest {
    pub key: String,
    pub value: String,
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.len() > MAX_KEY_BYTES
        || !key.starts_with("sb-")
        || key.is_empty()
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err("Chave de armazenamento seguro inválida".into());
    }
    Ok(())
}

fn validate_value(value: &str) -> Result<(), String> {
    if value.len() > MAX_VALUE_BYTES {
        return Err("Valor de armazenamento seguro excede o limite".into());
    }
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
mod platform {
    use super::{validate_key, validate_value};
    use keyring::Entry;
    use std::sync::{Mutex, MutexGuard};

    const SERVICE: &str = "br.com.semog.fichario";
    static STORE_LOCK: Mutex<()> = Mutex::new(());

    fn lock_store() -> Result<MutexGuard<'static, ()>, String> {
        STORE_LOCK
            .lock()
            .map_err(|_| "O armazenamento seguro ficou indisponível".into())
    }

    fn entry(key: &str) -> Result<Entry, String> {
        validate_key(key)?;
        Entry::new(SERVICE, key)
            .map_err(|_| "Não foi possível abrir o armazenamento seguro do sistema".into())
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        let _guard = lock_store()?;
        match entry(key)?.get_password() {
            Ok(value) => {
                validate_value(&value)?;
                Ok(Some(value))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Não foi possível ler o armazenamento seguro do sistema".into()),
        }
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        validate_value(value)?;
        let _guard = lock_store()?;
        entry(key)?
            .set_password(value)
            .map_err(|_| "Não foi possível salvar no armazenamento seguro do sistema".into())
    }

    pub fn remove(key: &str) -> Result<(), String> {
        let _guard = lock_store()?;
        match entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Não foi possível remover o armazenamento seguro do sistema".into()),
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
mod platform {
    use super::{validate_key, validate_value};

    pub fn get(key: &str) -> Result<Option<String>, String> {
        validate_key(key)?;
        Err("O armazenamento seguro nativo não está disponível nesta plataforma".into())
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        validate_key(key)?;
        validate_value(value)?;
        Err("O armazenamento seguro nativo não está disponível nesta plataforma".into())
    }

    pub fn remove(key: &str) -> Result<(), String> {
        validate_key(key)?;
        Err("O armazenamento seguro nativo não está disponível nesta plataforma".into())
    }
}

#[cfg(target_os = "android")]
mod android_platform {
    use super::{validate_key, validate_value};
    use tauri::Manager;
    use tauri_plugin_keyring_store::KeyringExt;

    const ERROR: &str = "Não foi possível acessar o armazenamento seguro do Android";

    pub fn get(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
        validate_key(key)?;
        app.keyring()
            .store
            .get_password(key)
            .map_err(|_| ERROR.to_string())
    }

    pub fn set(app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), String> {
        validate_key(key)?;
        validate_value(value)?;
        app.keyring()
            .store
            .set_password(key, value)
            .map_err(|_| ERROR.to_string())
    }

    pub fn remove(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
        validate_key(key)?;
        app.keyring()
            .store
            .delete(key)
            .map_err(|_| ERROR.to_string())
    }
}

#[tauri::command]
pub fn native_secure_storage_get(
    app: AppHandle,
    request: SecureStorageKeyRequest,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    return android_platform::get(&app, &request.key);
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        platform::get(&request.key)
    }
}

#[tauri::command]
pub fn native_secure_storage_set(
    app: AppHandle,
    request: SecureStorageSetRequest,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return android_platform::set(&app, &request.key, &request.value);
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        platform::set(&request.key, &request.value)
    }
}

#[tauri::command]
pub fn native_secure_storage_remove(
    app: AppHandle,
    request: SecureStorageKeyRequest,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return android_platform::remove(&app, &request.key);
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        platform::remove(&request.key)
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_key, validate_value, MAX_KEY_BYTES, MAX_VALUE_BYTES};

    #[test]
    fn accepts_only_supabase_storage_keys() {
        assert!(validate_key("sb-example.supabase.co-auth-token").is_ok());
        assert!(validate_key("localStorage").is_err());
        assert!(validate_key("sb-../escape").is_err());
        assert!(validate_key(&format!("sb-{}", "x".repeat(MAX_KEY_BYTES))).is_err());
    }

    #[test]
    fn bounds_secure_storage_values() {
        assert!(validate_value(&"x".repeat(MAX_VALUE_BYTES)).is_ok());
        assert!(validate_value(&"x".repeat(MAX_VALUE_BYTES + 1)).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires a desktop Secret Service/libsecret session"]
    fn linux_keyring_round_trip_when_desktop_keyring_is_available() {
        struct Cleanup<'a>(&'a str);

        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = super::platform::remove(self.0);
            }
        }

        use std::time::{SystemTime, UNIX_EPOCH};

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let key = format!("sb-fichario-linux-smoke-{}-{timestamp}", std::process::id());
        let value = "fichario-rust-linux-smoke-value";
        let _cleanup = Cleanup(&key);

        assert_eq!(
            super::platform::get(&key).expect("precondition lookup"),
            None
        );
        super::platform::set(&key, value).expect("Secret Service set");
        assert_eq!(
            super::platform::get(&key).expect("Secret Service get"),
            Some(value.into())
        );
        super::platform::remove(&key).expect("Secret Service remove");
        assert_eq!(
            super::platform::get(&key).expect("postcondition lookup"),
            None
        );
    }
}
