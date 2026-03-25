use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    error::{AppError, AppResult},
    extensions::builtin_extensions,
    models::{
        ActivityEntry, BootstrapState, CommandSnippet, ConnectionExportResult, ConnectionImportResult,
        ConnectionProfile, ConnectionTestResult, ConnectionValidationResult, PersistedState, RemoteFileEntry,
        SessionTab,
    },
    services::{connections, sessions},
};

/// Shared backend state managed by Tauri.
pub struct AppState {
    store: Mutex<AppStore>,
}

impl AppState {
    /// Creates the application state rooted at the Tauri config directory.
    pub fn new(config_dir: PathBuf) -> AppResult<Self> {
        Ok(Self {
            store: Mutex::new(AppStore::load(config_dir)?),
        })
    }

    /// Returns a snapshot consumed by the frontend bootstrap flow.
    pub fn snapshot(&self) -> AppResult<BootstrapState> {
        Ok(self.store.lock()?.snapshot())
    }

    /// Validates and normalizes a connection profile without persisting it.
    pub fn validate_connection_profile(
        &self,
        profile: ConnectionProfile,
    ) -> AppResult<ConnectionValidationResult> {
        let store = self.store.lock()?;
        store.validate_connection_profile(profile)
    }

    /// Runs the current simulated P0 connection test flow.
    pub fn test_connection_profile(&self, profile: ConnectionProfile) -> AppResult<ConnectionTestResult> {
        let store = self.store.lock()?;
        store.test_connection_profile(profile)
    }

    /// Imports connection profiles from a JSON payload.
    pub fn import_connection_profiles_json(
        &self,
        payload: &str,
    ) -> AppResult<ConnectionImportResult> {
        let mut store = self.store.lock()?;
        store.import_connection_profiles_json(payload)
    }

    /// Exports all connection profiles as a JSON string.
    pub fn export_connection_profiles_json(&self) -> AppResult<ConnectionExportResult> {
        let store = self.store.lock()?;
        store.export_connection_profiles_json()
    }

    pub fn save_connection_profile(&self, profile: ConnectionProfile) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.save_connection_profile(profile)?;
        Ok(store.snapshot())
    }

    pub fn delete_connection_profile(&self, connection_id: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.delete_connection_profile(connection_id)?;
        Ok(store.snapshot())
    }

    pub fn save_command_snippet(&self, snippet: CommandSnippet) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.save_command_snippet(snippet)?;
        Ok(store.snapshot())
    }

    pub fn delete_command_snippet(&self, snippet_id: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.delete_command_snippet(snippet_id)?;
        Ok(store.snapshot())
    }

    pub fn save_settings(&self, settings: crate::models::AppSettings) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.save_settings(settings)?;
        Ok(store.snapshot())
    }

    pub fn reset_settings(&self) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.reset_settings()?;
        Ok(store.snapshot())
    }

    pub fn open_session(&self, connection_id: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.open_session(connection_id)?;
        Ok(store.snapshot())
    }

    pub fn close_session(&self, session_id: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.close_session(session_id)?;
        Ok(store.snapshot())
    }

    /// Reconnects an existing simulated session.
    pub fn reconnect_session(&self, session_id: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.reconnect_session(session_id)?;
        Ok(store.snapshot())
    }

    /// Clears the tracked output of a simulated session.
    pub fn clear_session_output(&self, session_id: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.clear_session_output(session_id)?;
        Ok(store.snapshot())
    }

    /// Closes every simulated session except the target one.
    pub fn close_other_sessions(&self, session_id: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.close_other_sessions(session_id)?;
        Ok(store.snapshot())
    }

    /// Updates the simulated terminal size for a session.
    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.resize_session(session_id, cols, rows)?;
        Ok(store.snapshot())
    }

    pub fn send_session_input(&self, session_id: &str, input: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.send_session_input(session_id, input)?;
        Ok(store.snapshot())
    }

    pub fn run_snippet_on_session(&self, session_id: &str, snippet_id: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.run_snippet_on_session(session_id, snippet_id)?;
        Ok(store.snapshot())
    }

    pub fn list_remote_entries(&self, session_id: &str) -> AppResult<Vec<RemoteFileEntry>> {
        let store = self.store.lock()?;
        store.list_remote_entries(session_id)
    }
}

struct AppStore {
    storage_path: PathBuf,
    persisted: PersistedState,
    sessions: Vec<SessionTab>,
    activity: Vec<ActivityEntry>,
}

impl AppStore {
    fn load(config_dir: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&config_dir)?;
        let storage_path = config_dir.join("workspace-state.json");

        let persisted = if storage_path.exists() {
            let content = fs::read_to_string(&storage_path)?;
            serde_json::from_str::<PersistedState>(&content)
                .map_err(|error| AppError::new("invalid_state", error.to_string()))?
        } else {
            PersistedState::default()
        };

        Ok(Self {
            storage_path,
            persisted,
            sessions: Vec::new(),
            activity: vec![ActivityEntry {
                id: next_id("activity"),
                title: "工作台状态已初始化。".into(),
                timestamp: now_iso(),
            }],
        })
    }

    fn snapshot(&self) -> BootstrapState {
        BootstrapState {
            connections: self.persisted.connections.clone(),
            sessions: self.sessions.clone(),
            snippets: self.persisted.snippets.clone(),
            settings: self.persisted.settings.clone(),
            extensions: builtin_extensions(),
            activity: self.activity.clone(),
        }
    }

    fn validate_connection_profile(
        &self,
        profile: ConnectionProfile,
    ) -> AppResult<ConnectionValidationResult> {
        connections::validate_profile(profile, &self.persisted.connections)
    }

    fn test_connection_profile(&self, profile: ConnectionProfile) -> AppResult<ConnectionTestResult> {
        connections::simulate_connection_test(profile, &self.persisted.connections)
    }

    fn import_connection_profiles_json(&mut self, payload: &str) -> AppResult<ConnectionImportResult> {
        let (imported_profiles, skipped, duplicate_count) =
            connections::import_profiles_json(payload, &self.persisted.connections)?;

        for profile in &imported_profiles {
            upsert_by_id(&mut self.persisted.connections, profile.clone());
        }

        let imported = imported_profiles.len();
        self.record_activity(format!(
            "已导入 {} 个连接配置，跳过 {} 个导入内重复项，检测到 {} 个与现有配置重复的连接。",
            imported, skipped, duplicate_count
        ));
        self.persist()?;

        Ok(ConnectionImportResult {
            state: self.snapshot(),
            imported,
            skipped,
            duplicate_count,
            message: format!(
                "已导入 {} 个连接配置，跳过 {} 个导入内重复项，检测到 {} 个与现有配置重复的连接。",
                imported, skipped, duplicate_count
            ),
        })
    }

    fn export_connection_profiles_json(&self) -> AppResult<ConnectionExportResult> {
        let content = connections::export_profiles_json(&self.persisted.connections)?;

        Ok(ConnectionExportResult {
            content,
            count: self.persisted.connections.len(),
            exported_at: now_iso(),
        })
    }

    fn save_connection_profile(&mut self, profile: ConnectionProfile) -> AppResult<()> {
        let validation = self.validate_connection_profile(profile)?;
        upsert_by_id(
            &mut self.persisted.connections,
            validation.normalized_profile.clone(),
        );
        self.record_activity(format!(
            "已保存连接配置 {}。",
            validation.normalized_profile.name
        ));
        self.persist()
    }

    fn delete_connection_profile(&mut self, connection_id: &str) -> AppResult<()> {
        self.persisted.connections.retain(|item| item.id != connection_id);
        self.sessions.retain(|item| item.connection_id != connection_id);
        self.record_activity(format!("已删除连接配置 {}。", connection_id));
        self.persist()
    }

    fn save_command_snippet(&mut self, snippet: CommandSnippet) -> AppResult<()> {
        upsert_by_id(&mut self.persisted.snippets, snippet.clone());
        self.record_activity(format!("已保存命令片段 {}。", snippet.name));
        self.persist()
    }

    fn delete_command_snippet(&mut self, snippet_id: &str) -> AppResult<()> {
        self.persisted.snippets.retain(|item| item.id != snippet_id);
        self.record_activity(format!("已删除命令片段 {}。", snippet_id));
        self.persist()
    }

    fn save_settings(&mut self, settings: crate::models::AppSettings) -> AppResult<()> {
        self.persisted.settings = settings;
        self.record_activity("已保存工作台设置。".into());
        self.persist()
    }

    fn reset_settings(&mut self) -> AppResult<()> {
        self.persisted.settings = crate::models::AppSettings::default();
        self.record_activity("已重置工作台设置。".into());
        self.persist()
    }

    fn open_session(&mut self, connection_id: &str) -> AppResult<()> {
        let connection = {
            let connection = self
                .persisted
                .connections
                .iter_mut()
                .find(|item| item.id == connection_id)
                .ok_or_else(|| AppError::new("connection_not_found", connection_id.to_string()))?;

            let now = now_iso();
            connection.last_connected_at = Some(now.clone());

            connection.clone()
        };

        self.sessions.insert(0, sessions::open_simulated_session(&connection));
        self.record_activity(format!("已为 {} 打开会话。", connection.name));
        self.persist()
    }

    fn close_session(&mut self, session_id: &str) -> AppResult<()> {
        let session_title = sessions::close_session(&mut self.sessions, session_id)?;
        self.record_activity(format!("已关闭会话 {}。", session_title));
        self.persist()
    }

    fn reconnect_session(&mut self, session_id: &str) -> AppResult<()> {
        let connection = self
            .find_connection_for_session(session_id)?
            .clone();
        let session_title = sessions::reconnect_session(&mut self.sessions, session_id, &connection)?;
        self.record_activity(format!("已重新连接会话 {}。", session_title));
        self.persist()
    }

    fn clear_session_output(&mut self, session_id: &str) -> AppResult<()> {
        let session_title = sessions::clear_session_output(&mut self.sessions, session_id)?;
        self.record_activity(format!("已清空会话 {} 的输出。", session_title));
        self.persist()
    }

    fn close_other_sessions(&mut self, session_id: &str) -> AppResult<()> {
        let removed = sessions::close_other_sessions(&mut self.sessions, session_id)?;
        self.record_activity(format!("已关闭 {} 个其它会话。", removed));
        self.persist()
    }

    fn resize_session(&mut self, session_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let session_title = sessions::resize_session(&mut self.sessions, session_id, cols, rows)?;
        self.record_activity(format!(
            "已将会话 {} 调整为 {}x{}。",
            session_title, cols, rows
        ));
        self.persist()
    }

    fn send_session_input(&mut self, session_id: &str, input: &str) -> AppResult<()> {
        let session_title = sessions::send_session_input(&mut self.sessions, session_id, input)?;
        self.record_activity(format!("已向 {} 发送命令。", session_title));
        self.persist()
    }

    fn run_snippet_on_session(&mut self, session_id: &str, snippet_id: &str) -> AppResult<()> {
        let command = self
            .persisted
            .snippets
            .iter()
            .find(|item| item.id == snippet_id)
            .map(|item| item.command.clone())
            .ok_or_else(|| AppError::new("snippet_not_found", snippet_id.to_string()))?;

        self.send_session_input(session_id, &command)
    }

    fn list_remote_entries(&self, session_id: &str) -> AppResult<Vec<RemoteFileEntry>> {
        let session = self
            .sessions
            .iter()
            .find(|item| item.id == session_id)
            .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;

        let base = session
            .current_path
            .clone()
            .unwrap_or_else(|| "/home/demo".into());

        Ok(vec![
            RemoteFileEntry {
                name: "deploy".into(),
                path: format!("{}/deploy", base),
                kind: "directory".into(),
                size: 0,
                modified_at: now_iso(),
            },
            RemoteFileEntry {
                name: "logs".into(),
                path: format!("{}/logs", base),
                kind: "directory".into(),
                size: 0,
                modified_at: now_iso(),
            },
            RemoteFileEntry {
                name: "README.md".into(),
                path: format!("{}/README.md", base),
                kind: "file".into(),
                size: 1480,
                modified_at: now_iso(),
            },
        ])
    }

    fn find_connection_for_session(&self, session_id: &str) -> AppResult<&ConnectionProfile> {
        let session = self
            .sessions
            .iter()
            .find(|item| item.id == session_id)
            .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;

        self.persisted
            .connections
            .iter()
            .find(|item| item.id == session.connection_id)
            .ok_or_else(|| AppError::new("connection_not_found", session.connection_id.clone()))
    }

    fn persist(&self) -> AppResult<()> {
        let content = serde_json::to_string_pretty(&self.persisted)
            .map_err(|error| AppError::new("serialize_state", error.to_string()))?;
        fs::write(&self.storage_path, content)?;
        Ok(())
    }

    fn record_activity(&mut self, title: String) {
        self.activity.insert(
            0,
            ActivityEntry {
                id: next_id("activity"),
                title,
                timestamp: now_iso(),
            },
        );
        self.activity.truncate(20);
    }
}

fn upsert_by_id<T>(items: &mut Vec<T>, next: T)
where
    T: Clone + HasId,
{
    if let Some(index) = items.iter().position(|item| item.id() == next.id()) {
        items[index] = next;
    } else {
        items.insert(0, next);
    }
}

trait HasId {
    fn id(&self) -> &str;
}

impl HasId for ConnectionProfile {
    fn id(&self) -> &str {
        &self.id
    }
}

impl HasId for CommandSnippet {
    fn id(&self) -> &str {
        &self.id
    }
}

fn next_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{}-{}", prefix, nanos)
}

fn now_iso() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::PathBuf};

    use super::AppState;
    use crate::models::ConnectionProfile;

    fn temp_config_dir(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("termorax-tests-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    fn profile(id: &str) -> ConnectionProfile {
        ConnectionProfile {
            id: id.into(),
            name: "测试主机".into(),
            host: "10.0.0.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: "password".into(),
            group: "默认分组".into(),
            tags: vec![],
            note: "".into(),
            last_connected_at: None,
        }
    }

    #[test]
    fn app_state_imports_and_exports_profiles() {
        let dir = temp_config_dir("import-export");
        let state = AppState::new(dir).expect("state should initialize");
        let payload = serde_json::to_string(&vec![profile("conn-test-import")]).expect("json should serialize");

        let import_result = state
            .import_connection_profiles_json(&payload)
            .expect("import should succeed");
        let exported = state
            .export_connection_profiles_json()
            .expect("export should succeed");

        assert_eq!(import_result.imported, 1);
        assert_eq!(exported.count, 3);
        assert!(exported.content.contains("conn-test-import"));
    }

    #[test]
    fn app_state_validates_connection_profiles() {
        let dir = temp_config_dir("validate");
        let state = AppState::new(dir).expect("state should initialize");
        let result = state
            .validate_connection_profile(profile("conn-validate"))
            .expect("validation should succeed");

        assert_eq!(result.normalized_profile.name, "测试主机");
    }

    #[test]
    fn app_state_supports_session_runtime_actions() {
        let dir = temp_config_dir("session-actions");
        let state = AppState::new(dir).expect("state should initialize");
        let opened = state
            .open_session("conn-prod-app-01")
            .expect("session should open");
        let session_id = opened.sessions[0].id.clone();

        let resized = state
            .resize_session(&session_id, 150, 40)
            .expect("resize should succeed");
        assert_eq!(resized.sessions[0].terminal_cols, 150);
        assert_eq!(resized.sessions[0].terminal_rows, 40);

        let cleared = state
            .clear_session_output(&session_id)
            .expect("clear should succeed");
        assert_eq!(cleared.sessions[0].last_output, "[模拟器] 会话输出已清空。");

        let reconnected = state
            .reconnect_session(&session_id)
            .expect("reconnect should succeed");
        assert!(reconnected.sessions[0].last_output.contains("已重新连接"));
    }

    #[test]
    fn app_state_closes_other_sessions() {
        let dir = temp_config_dir("close-others");
        let state = AppState::new(dir).expect("state should initialize");
        let first = state
            .open_session("conn-prod-app-01")
            .expect("first session should open");
        let keep_id = first.sessions[0].id.clone();
        let second = state
            .open_session("conn-stage-bastion")
            .expect("second session should open");
        assert_eq!(second.sessions.len(), 2);

        let remaining = state
            .close_other_sessions(&keep_id)
            .expect("close others should succeed");

        assert_eq!(remaining.sessions.len(), 1);
        assert_eq!(remaining.sessions[0].id, keep_id);
    }
}
