use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, client};
use tauri::{AppHandle, Emitter};

use crate::{
    error::{AppError, AppResult},
    events::{SESSION_EVENT, SessionOutputEventPayload, SessionStatusEventPayload},
    extensions::builtin_extensions,
    models::{
        ActivityEntry, BootstrapState, CommandSnippet, ConnectionExportResult, ConnectionImportResult,
        ConnectionProfile, ConnectionTestResult, ConnectionValidationResult, PersistedState, RemoteFileEntry,
        SessionTab,
    },
    services::{connections, sessions, sftp, ssh},
};

struct LiveSessionRuntime {
    connection: client::Handle<ssh::TermoraXClientHandler>,
    writer: ChannelWriteHalf<client::Msg>,
}

impl LiveSessionRuntime {
    fn send_input(&self, input: &str) -> AppResult<()> {
        tauri::async_runtime::block_on(ssh::default_ssh_service().send_input(&self.writer, input))
    }

    fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
        tauri::async_runtime::block_on(ssh::default_ssh_service().resize_shell(&self.writer, cols, rows))
    }

    fn close(mut self) -> AppResult<()> {
        tauri::async_runtime::block_on(
            ssh::default_ssh_service().close_shell(&mut self.connection, &self.writer),
        )
    }
}

enum SessionUiEvent {
    Output(SessionOutputEventPayload),
    Status(SessionStatusEventPayload),
}

/// Shared backend state managed by Tauri.
pub struct AppState {
    store: Arc<Mutex<AppStore>>,
}

impl AppState {
    /// Creates the application state rooted at the Tauri config directory.
    pub fn new(config_dir: PathBuf) -> AppResult<Self> {
        Ok(Self {
            store: Arc::new(Mutex::new(AppStore::load(config_dir)?)),
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

    /// Runs the current SSH preflight validation flow without persisting the profile.
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

    pub fn open_session(&self, app_handle: &AppHandle, connection_id: &str) -> AppResult<BootstrapState> {
        let connection = {
            let store = self.store.lock()?;
            store.find_connection(connection_id)?.clone()
        };

        let opened = tauri::async_runtime::block_on(
            ssh::default_ssh_service().open_shell_session(
                &connection,
                sessions::DEFAULT_TERMINAL_COLS,
                sessions::DEFAULT_TERMINAL_ROWS,
            ),
        )?;
        let session_id = {
            let mut store = self.store.lock()?;
            store.open_live_session(&connection, opened.connection, opened.writer)?
        };

        self.spawn_session_reader(app_handle.clone(), session_id, opened.reader);
        self.snapshot()
    }

    pub fn close_session(&self, session_id: &str) -> AppResult<BootstrapState> {
        let runtime = {
            let mut store = self.store.lock()?;
            store.close_session(session_id)?
        };

        if let Some(runtime) = runtime {
            runtime.close()?;
        }

        self.snapshot()
    }

    /// Reconnects an existing live session while keeping the current tab identifier.
    pub fn reconnect_session(&self, app_handle: &AppHandle, session_id: &str) -> AppResult<BootstrapState> {
        let (connection, cols, rows, previous_runtime) = {
            let mut store = self.store.lock()?;
            let connection = store.find_connection_for_session(session_id)?.clone();
            let session = store
                .sessions
                .iter()
                .find(|item| item.id == session_id)
                .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;

            (
                connection,
                session.terminal_cols,
                session.terminal_rows,
                store.runtimes.remove(session_id),
            )
        };

        if let Some(runtime) = previous_runtime {
            runtime.close()?;
        }

        let opened = tauri::async_runtime::block_on(
            ssh::default_ssh_service().open_shell_session(&connection, cols, rows),
        )?;
        {
            let mut store = self.store.lock()?;
            store.reconnect_live_session(session_id, &connection, opened.connection, opened.writer)?;
        }

        self.spawn_session_reader(app_handle.clone(), session_id.to_string(), opened.reader);
        self.snapshot()
    }

    /// Clears the tracked output buffer for a session.
    pub fn clear_session_output(&self, session_id: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.clear_session_output(session_id)?;
        Ok(store.snapshot())
    }

    /// Closes every live session except the target one.
    pub fn close_other_sessions(&self, session_id: &str) -> AppResult<BootstrapState> {
        let runtimes = {
            let mut store = self.store.lock()?;
            store.close_other_sessions(session_id)?
        };

        for runtime in runtimes {
            runtime.close()?;
        }

        self.snapshot()
    }

    /// Updates the PTY size tracked for a session and forwards it to the remote host.
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
        let mut store = self.store.lock()?;
        store.list_remote_entries(session_id)
    }

    fn spawn_session_reader(&self, app_handle: AppHandle, session_id: String, mut reader: ChannelReadHalf) {
        let store = Arc::clone(&self.store);

        tauri::async_runtime::spawn(async move {
            while let Some(message) = reader.wait().await {
                let payload = match store.lock() {
                    Ok(mut guard) => guard.apply_terminal_event(&session_id, message),
                    Err(_) => None,
                };

                if let Some(payload) = payload {
                    emit_session_event(&app_handle, payload);
                }
            }

            if let Ok(mut guard) = store.lock() {
                if let Some(payload) = guard.mark_session_disconnected(&session_id, "\r\n[TermoraX] SSH 连接已断开。")
                {
                    emit_session_event(&app_handle, payload);
                }
            }
        });
    }
}

struct AppStore {
    storage_path: PathBuf,
    persisted: PersistedState,
    sessions: Vec<SessionTab>,
    activity: Vec<ActivityEntry>,
    runtimes: HashMap<String, LiveSessionRuntime>,
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
            runtimes: HashMap::new(),
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
        let result = connections::simulate_connection_test(profile, &self.persisted.connections)?;
        ssh::default_ssh_service().prepare_connection_from_profile(&result.normalized_profile)?;
        Ok(result)
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

    fn open_live_session(
        &mut self,
        connection: &ConnectionProfile,
        ssh_connection: client::Handle<ssh::TermoraXClientHandler>,
        writer: ChannelWriteHalf<client::Msg>,
    ) -> AppResult<String> {
        if let Some(stored) = self
            .persisted
            .connections
            .iter_mut()
            .find(|item| item.id == connection.id)
        {
            stored.last_connected_at = Some(now_iso());
        }

        let session = sessions::open_connected_session(
            connection,
            format!(
                "已连接到 {}@{}:{}\r\n\r\n[TermoraX] 真实 SSH 传输已建立。",
                connection.username, connection.host, connection.port
            ),
            sessions::DEFAULT_TERMINAL_COLS,
            sessions::DEFAULT_TERMINAL_ROWS,
        );
        let session_id = session.id.clone();
        self.runtimes.insert(
            session_id.clone(),
            LiveSessionRuntime {
                connection: ssh_connection,
                writer,
            },
        );
        self.sessions.insert(0, session);
        self.record_activity(format!("已为 {} 打开会话。", connection.name));
        self.persist()?;

        Ok(session_id)
    }

    fn close_session(&mut self, session_id: &str) -> AppResult<Option<LiveSessionRuntime>> {
        let session_title = sessions::close_session(&mut self.sessions, session_id)?;
        let runtime = self.runtimes.remove(session_id);
        self.record_activity(format!("已关闭会话 {}。", session_title));
        self.persist()?;

        Ok(runtime)
    }

    fn reconnect_live_session(
        &mut self,
        session_id: &str,
        connection: &ConnectionProfile,
        ssh_connection: client::Handle<ssh::TermoraXClientHandler>,
        writer: ChannelWriteHalf<client::Msg>,
    ) -> AppResult<()> {
        let session_title = {
            let session = self
                .sessions
                .iter_mut()
                .find(|item| item.id == session_id)
                .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;
            let session_title = session.title.clone();
            session.status = "connected".into();
            session.current_path = Some(format!("/home/{}", connection.username));
            session.last_output = format!(
                "已重新连接到 {}@{}:{}\r\n\r\n[TermoraX] 真实 SSH 终端已恢复。",
                connection.username, connection.host, connection.port
            );
            session.updated_at = now_iso();
            session_title
        };
        self.runtimes.insert(
            session_id.to_string(),
            LiveSessionRuntime {
                connection: ssh_connection,
                writer,
            },
        );
        self.record_activity(format!("已重新连接会话 {}。", session_title));
        self.persist()
    }

    fn clear_session_output(&mut self, session_id: &str) -> AppResult<()> {
        let session_title = sessions::clear_session_output(&mut self.sessions, session_id)?;
        self.record_activity(format!("已清空会话 {} 的输出。", session_title));
        Ok(())
    }

    fn close_other_sessions(&mut self, session_id: &str) -> AppResult<Vec<LiveSessionRuntime>> {
        let removed = sessions::close_other_sessions(&mut self.sessions, session_id)?;
        let removed_ids = self
            .runtimes
            .keys()
            .filter(|id| id.as_str() != session_id)
            .cloned()
            .collect::<Vec<_>>();
        let mut runtimes = Vec::with_capacity(removed_ids.len());
        for removed_id in removed_ids {
            if let Some(runtime) = self.runtimes.remove(&removed_id) {
                runtimes.push(runtime);
            }
        }

        self.record_activity(format!("已关闭 {} 个其它会话。", removed));
        Ok(runtimes)
    }

    fn resize_session(&mut self, session_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let runtime = self
            .runtimes
            .get(session_id)
            .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;
        runtime.resize(cols, rows)?;
        let session_title = sessions::resize_session(&mut self.sessions, session_id, cols, rows)?;
        self.record_activity(format!(
            "已将会话 {} 调整为 {}x{}。",
            session_title, cols, rows
        ));
        Ok(())
    }

    fn send_session_input(&mut self, session_id: &str, input: &str) -> AppResult<()> {
        let runtime = self
            .runtimes
            .get(session_id)
            .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;
        runtime.send_input(input)?;
        let session = self
            .sessions
            .iter_mut()
            .find(|item| item.id == session_id)
            .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;
        session.updated_at = now_iso();
        Ok(())
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

    fn list_remote_entries(&mut self, session_id: &str) -> AppResult<Vec<RemoteFileEntry>> {
        let session = self
            .sessions
            .iter()
            .find(|item| item.id == session_id)
            .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;
        let runtime = self
            .runtimes
            .get(session_id)
            .ok_or_else(|| AppError::new("session_not_connected", "当前会话尚未建立实时 SSH 连接"))?;
        let requested_path = session.current_path.clone().unwrap_or_else(|| ".".into());

        let listing = tauri::async_runtime::block_on(
            sftp::default_sftp_service().list_directory(&runtime.connection, &requested_path),
        )?;

        if let Some(session) = self.sessions.iter_mut().find(|item| item.id == session_id) {
            session.current_path = Some(listing.canonical_path.clone());
            session.updated_at = now_iso();
        }

        Ok(listing.entries)
    }

    fn find_connection(&self, connection_id: &str) -> AppResult<&ConnectionProfile> {
        self.persisted
            .connections
            .iter()
            .find(|item| item.id == connection_id)
            .ok_or_else(|| AppError::new("connection_not_found", connection_id.to_string()))
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

    fn apply_terminal_event(
        &mut self,
        session_id: &str,
        message: ChannelMsg,
    ) -> Option<SessionUiEvent> {
        match message {
            ChannelMsg::Data { data } => {
                let chunk = String::from_utf8_lossy(&data).to_string();
                if chunk.is_empty() {
                    return None;
                }
                sessions::append_session_output(&mut self.sessions, session_id, &chunk).ok()?;
                Some(SessionUiEvent::Output(SessionOutputEventPayload {
                    kind: "output",
                    session_id: session_id.to_string(),
                    stream: "stdout",
                    chunk,
                    occurred_at: now_iso(),
                }))
            }
            ChannelMsg::ExtendedData { data, .. } => {
                let chunk = String::from_utf8_lossy(&data).to_string();
                if chunk.is_empty() {
                    return None;
                }
                sessions::append_session_output(&mut self.sessions, session_id, &chunk).ok()?;
                Some(SessionUiEvent::Output(SessionOutputEventPayload {
                    kind: "output",
                    session_id: session_id.to_string(),
                    stream: "stderr",
                    chunk,
                    occurred_at: now_iso(),
                }))
            }
            ChannelMsg::ExitStatus { exit_status } => self.mark_session_disconnected(
                session_id,
                &format!("\r\n[TermoraX] 远端会话已退出，状态码 {}。", exit_status),
            ),
            ChannelMsg::ExitSignal {
                signal_name,
                error_message,
                ..
            } => self.mark_session_disconnected(
                session_id,
                &format!("\r\n[TermoraX] 远端会话因信号 {:?} 结束：{}", signal_name, error_message),
            ),
            ChannelMsg::Close | ChannelMsg::Eof => {
                self.mark_session_disconnected(session_id, "\r\n[TermoraX] SSH 连接已断开。")
            }
            _ => None,
        }
    }

    fn mark_session_disconnected(
        &mut self,
        session_id: &str,
        message: &str,
    ) -> Option<SessionUiEvent> {
        let session_title =
            sessions::set_session_status(&mut self.sessions, session_id, "disconnected", Some(message)).ok()?;
        self.runtimes.remove(session_id);
        self.record_activity(format!("会话 {} 已断开。", session_title));

        Some(SessionUiEvent::Status(SessionStatusEventPayload {
            kind: "status",
            session_id: session_id.to_string(),
            status: "disconnected".into(),
            message: Some(message.to_string()),
            error_code: None,
            occurred_at: now_iso(),
        }))
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

fn emit_session_event(app_handle: &AppHandle, event: SessionUiEvent) {
    match event {
        SessionUiEvent::Output(payload) => {
            let _ = app_handle.emit(SESSION_EVENT, payload);
        }
        SessionUiEvent::Status(payload) => {
            let _ = app_handle.emit(SESSION_EVENT, payload);
        }
    }
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
            password: "secret".into(),
            private_key_path: String::new(),
            private_key_passphrase: String::new(),
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
}
