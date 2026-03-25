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
        ActivityEntry, BootstrapState, CommandSnippet, ConnectionProfile, PersistedState, RemoteFileEntry,
        SessionTab,
    },
};

pub struct AppState {
    store: Mutex<AppStore>,
}

impl AppState {
    pub fn new(config_dir: PathBuf) -> AppResult<Self> {
        Ok(Self {
            store: Mutex::new(AppStore::load(config_dir)?),
        })
    }

    pub fn snapshot(&self) -> AppResult<BootstrapState> {
        Ok(self.store.lock()?.snapshot())
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

    fn save_connection_profile(&mut self, profile: ConnectionProfile) -> AppResult<()> {
        upsert_by_id(&mut self.persisted.connections, profile.clone());
        self.record_activity(format!("已保存连接配置 {}。", profile.name));
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
        let (connection_name, connection_username, connection_host, connection_port, connection_id_value) = {
            let connection = self
                .persisted
                .connections
                .iter_mut()
                .find(|item| item.id == connection_id)
                .ok_or_else(|| AppError::new("connection_not_found", connection_id.to_string()))?;

            let now = now_iso();
            connection.last_connected_at = Some(now.clone());

            (
                connection.name.clone(),
                connection.username.clone(),
                connection.host.clone(),
                connection.port,
                connection.id.clone(),
            )
        };

        let now = now_iso();

        self.sessions.insert(
            0,
            SessionTab {
                id: next_id("session"),
                connection_id: connection_id_value,
                title: connection_name.clone(),
                protocol: "ssh".into(),
                status: "connected".into(),
                current_path: Some(format!("/home/{}", connection_username)),
                last_output: format!(
                    "已连接到 {}@{}:{}\n\n[模拟器] SSH 传输层当前仍为桩实现。\n[模拟器] Rust 命令边界、持久化与工作台生命周期已经接通。",
                    connection_username, connection_host, connection_port
                ),
                created_at: now.clone(),
                updated_at: now.clone(),
            },
        );

        self.record_activity(format!("已为 {} 打开会话。", connection_name));
        self.persist()
    }

    fn close_session(&mut self, session_id: &str) -> AppResult<()> {
        self.sessions.retain(|item| item.id != session_id);
        self.record_activity(format!("已关闭会话 {}。", session_id));
        self.persist()
    }

    fn send_session_input(&mut self, session_id: &str, input: &str) -> AppResult<()> {
        let session_title = {
            let session = self
                .sessions
                .iter_mut()
                .find(|item| item.id == session_id)
                .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;

            session.last_output = format!(
                "{}\n\n$ {}\n[模拟器] Rust 宿主边界已接收该命令。",
                session.last_output,
                input.trim()
            );
            session.updated_at = now_iso();
            session.title.clone()
        };

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
