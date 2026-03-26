use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use russh::{client, ChannelMsg, ChannelReadHalf, ChannelWriteHalf};
use tauri::{AppHandle, Emitter};

use crate::{
    error::{AppError, AppResult},
    events::{SessionOutputEventPayload, SessionStatusEventPayload, SESSION_EVENT},
    extensions::builtin_extensions,
    models::{
        ActivityEntry, BootstrapState, CommandSnippet, ConnectionExportResult,
        ConnectionImportResult, ConnectionProfile, ConnectionTestResult,
        ConnectionValidationResult, HostFingerprintInspection, PersistedState,
        RemoteDirectoryListing, RemoteFileEntry, SessionTab, TransferTask, TrustedHost,
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
        tauri::async_runtime::block_on(ssh::default_ssh_service().resize_shell(
            &self.writer,
            cols,
            rows,
        ))
    }

    fn close_detached(mut self, context: &'static str) {
        tauri::async_runtime::spawn(async move {
            debug_log("runtime_close.start", format!("context={context}"));
            let result = ssh::default_ssh_service()
                .close_shell(&mut self.connection, &self.writer)
                .await;

            match result {
                Ok(()) => debug_log("runtime_close.done", format!("context={context}")),
                Err(error) => debug_log(
                    "runtime_close.failed",
                    format!(
                        "context={context} code={} message={}",
                        error.code, error.message
                    ),
                ),
            }
        });
    }
}

enum SessionUiEvent {
    Output(SessionOutputEventPayload),
    Status(SessionStatusEventPayload),
}

const SESSION_EVENT_FLUSH_DELAY_MS: u64 = 33;
const MAX_BATCHED_SESSION_OUTPUT_CHARS: usize = 16 * 1024;

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
    pub fn test_connection_profile(
        &self,
        profile: ConnectionProfile,
    ) -> AppResult<ConnectionTestResult> {
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

    /// Inspects the current SSH host fingerprint for a saved connection without opening a shell.
    pub fn inspect_connection_host(
        &self,
        connection_id: &str,
    ) -> AppResult<HostFingerprintInspection> {
        let (connection, trusted_host) = {
            let store = self.store.lock()?;
            let connection = store.find_connection(connection_id)?.clone();
            let trusted_host = store
                .find_trusted_host(&connection.host, connection.port)
                .cloned();

            (connection, trusted_host)
        };
        let inspected_host =
            tauri::async_runtime::block_on(ssh::default_ssh_service().inspect_host(&connection))?;

        Ok(build_host_fingerprint_inspection(
            &connection,
            &inspected_host,
            trusted_host.as_ref(),
        ))
    }

    /// Persists the current inspected fingerprint as the trusted host key for a saved connection.
    pub fn trust_connection_host(
        &self,
        connection_id: &str,
        fingerprint: &str,
    ) -> AppResult<HostFingerprintInspection> {
        let connection = {
            let store = self.store.lock()?;
            store.find_connection(connection_id)?.clone()
        };
        let inspected_host =
            tauri::async_runtime::block_on(ssh::default_ssh_service().inspect_host(&connection))?;
        ensure_trust_request_matches(fingerprint, &inspected_host)?;

        let mut store = self.store.lock()?;
        store.trust_connection_host(&connection, &inspected_host)
    }

    pub fn open_session(
        &self,
        app_handle: &AppHandle,
        connection_id: &str,
    ) -> AppResult<BootstrapState> {
        let (connection, trusted_host) = {
            let store = self.store.lock()?;
            let connection = store.find_connection(connection_id)?.clone();
            let trusted_host = store
                .find_trusted_host(&connection.host, connection.port)
                .cloned()
                .ok_or_else(|| {
                    AppError::new(
                        "ssh_host_untrusted",
                        "当前主机尚未信任，请先确认并信任主机指纹",
                    )
                })?;

            (connection, trusted_host)
        };

        let opened =
            tauri::async_runtime::block_on(ssh::default_ssh_service().open_shell_session(
                &connection,
                &trusted_host,
                sessions::DEFAULT_TERMINAL_COLS,
                sessions::DEFAULT_TERMINAL_ROWS,
            ))?;
        let (session_id, reader_generation) = {
            let mut store = self.store.lock()?;
            let session_id =
                store.open_live_session(&connection, opened.connection, opened.writer)?;
            let reader_generation = store.current_reader_generation(&session_id)?;
            (session_id, reader_generation)
        };

        self.spawn_session_reader(
            app_handle.clone(),
            session_id,
            reader_generation,
            opened.reader,
        );
        self.snapshot()
    }

    pub fn close_session(&self, session_id: &str) -> AppResult<BootstrapState> {
        let runtime = {
            let mut store = self.store.lock()?;
            store.close_session(session_id)?
        };

        if let Some(runtime) = runtime {
            runtime.close_detached("close_session");
        }

        self.snapshot()
    }

    /// Reconnects an existing live session while keeping the current tab identifier.
    pub fn reconnect_session(
        &self,
        app_handle: &AppHandle,
        session_id: &str,
    ) -> AppResult<BootstrapState> {
        debug_log(
            "reconnect_session.start",
            format!("session_id={session_id}"),
        );
        let (connection, trusted_host, cols, rows, previous_runtime) = {
            let mut store = self.store.lock()?;
            let connection = store.find_connection_for_session(session_id)?.clone();
            let trusted_host = store
                .find_trusted_host(&connection.host, connection.port)
                .cloned()
                .ok_or_else(|| {
                    AppError::new(
                        "ssh_host_untrusted",
                        "当前主机尚未信任，请先确认并信任主机指纹",
                    )
                })?;
            let (cols, rows) = {
                let session = store
                    .sessions
                    .iter()
                    .find(|item| item.id == session_id)
                    .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;
                (session.terminal_cols, session.terminal_rows)
            };

            store.bump_reader_generation(session_id);

            (
                connection,
                trusted_host,
                cols,
                rows,
                store.runtimes.remove(session_id),
            )
        };

        if let Some(runtime) = previous_runtime {
            debug_log(
                "reconnect_session.close_previous.schedule",
                format!("session_id={session_id}"),
            );
            runtime.close_detached("reconnect_session");
        } else {
            debug_log(
                "reconnect_session.close_previous.skip",
                format!("session_id={session_id}"),
            );
        }

        debug_log(
            "reconnect_session.open_new.start",
            format!("session_id={session_id} cols={cols} rows={rows}"),
        );
        let opened = tauri::async_runtime::block_on(
            ssh::default_ssh_service().open_shell_session(&connection, &trusted_host, cols, rows),
        )?;
        debug_log(
            "reconnect_session.open_new.done",
            format!("session_id={session_id}"),
        );
        let reader_generation = {
            let mut store = self.store.lock()?;
            store.reconnect_live_session(
                session_id,
                &connection,
                opened.connection,
                opened.writer,
            )?;
            store.current_reader_generation(session_id)?
        };

        self.spawn_session_reader(
            app_handle.clone(),
            session_id.to_string(),
            reader_generation,
            opened.reader,
        );
        debug_log(
            "reconnect_session.done",
            format!("session_id={session_id} reader_generation={reader_generation}"),
        );
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
            runtime.close_detached("close_other_sessions");
        }

        self.snapshot()
    }

    /// Updates the PTY size tracked for a session and forwards it to the remote host.
    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let mut store = self.store.lock()?;
        store.resize_session(session_id, cols, rows)?;
        Ok(())
    }

    pub fn send_session_input(&self, session_id: &str, input: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.send_session_input(session_id, input)?;
        Ok(store.snapshot())
    }

    pub fn run_snippet_on_session(
        &self,
        session_id: &str,
        snippet_id: &str,
    ) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.run_snippet_on_session(session_id, snippet_id)?;
        Ok(store.snapshot())
    }

    pub fn list_remote_entries(&self, session_id: &str) -> AppResult<Vec<RemoteFileEntry>> {
        debug_log(
            "list_remote_entries.request",
            format!("session_id={session_id}"),
        );
        let (runtime, requested_path) = {
            let mut store = self.store.lock()?;
            let requested_path = store
                .sessions
                .iter()
                .find(|item| item.id == session_id)
                .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?
                .current_path
                .clone()
                .unwrap_or_else(|| ".".into());
            let runtime = store.take_runtime(session_id)?;
            (runtime, requested_path)
        };
        let started_at = Instant::now();
        let result = tauri::async_runtime::block_on(
            sftp::default_sftp_service().list_directory(&runtime.connection, &requested_path),
        );
        let result = {
            let mut store = self.store.lock()?;
            store.restore_runtime(session_id, runtime);
            match result {
                Ok(listing) => {
                    store.update_session_current_path(session_id, &listing.canonical_path)?;
                    Ok(listing.entries)
                }
                Err(error) => Err(error),
            }
        };
        debug_log(
            "list_remote_entries.done",
            format!(
                "session_id={session_id} ok={} elapsed_ms={}",
                result.is_ok(),
                started_at.elapsed().as_millis()
            ),
        );
        result
    }

    /// Lists a remote directory without mutating the session's tracked working path.
    pub fn list_remote_entries_at_path(
        &self,
        session_id: &str,
        path: &str,
    ) -> AppResult<RemoteDirectoryListing> {
        debug_log(
            "list_remote_entries_at_path.request",
            format!("session_id={session_id} path={path}"),
        );
        let runtime = {
            let mut store = self.store.lock()?;
            store.take_runtime(session_id)?
        };
        let started_at = Instant::now();
        let result = tauri::async_runtime::block_on(
            sftp::default_sftp_service().list_directory(&runtime.connection, path),
        );
        let result = {
            let mut store = self.store.lock()?;
            store.restore_runtime(session_id, runtime);
            result.map(|listing| RemoteDirectoryListing {
                canonical_path: listing.canonical_path,
                entries: listing.entries,
            })
        };
        debug_log(
            "list_remote_entries_at_path.done",
            format!(
                "session_id={session_id} path={path} ok={} elapsed_ms={}",
                result.is_ok(),
                started_at.elapsed().as_millis()
            ),
        );
        result
    }

    /// Navigates the tracked remote working directory to the provided target path.
    pub fn navigate_remote_directory(
        &self,
        session_id: &str,
        path: &str,
    ) -> AppResult<BootstrapState> {
        debug_log(
            "navigate_remote_directory.request",
            format!("session_id={session_id} path={path}"),
        );
        let runtime = {
            let mut store = self.store.lock()?;
            store.take_runtime(session_id)?
        };
        let started_at = Instant::now();
        let result = tauri::async_runtime::block_on(
            sftp::default_sftp_service().list_directory(&runtime.connection, path),
        );
        let mut store = self.store.lock()?;
        store.restore_runtime(session_id, runtime);
        let listing = result?;
        store.update_session_current_path(session_id, &listing.canonical_path)?;
        debug_log(
            "navigate_remote_directory.done",
            format!(
                "session_id={session_id} path={path} elapsed_ms={}",
                started_at.elapsed().as_millis()
            ),
        );
        Ok(store.snapshot())
    }

    /// Navigates the tracked remote working directory to the parent path.
    pub fn navigate_remote_to_parent(&self, session_id: &str) -> AppResult<BootstrapState> {
        debug_log(
            "navigate_remote_to_parent.request",
            format!("session_id={session_id}"),
        );
        let (runtime, parent_path) = {
            let mut store = self.store.lock()?;
            let current_path = store
                .sessions
                .iter()
                .find(|item| item.id == session_id)
                .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?
                .current_path
                .clone()
                .unwrap_or_else(|| "/".into());
            let parent_path = parent_remote_path(&current_path);
            let runtime = store.take_runtime(session_id)?;
            (runtime, parent_path)
        };
        let started_at = Instant::now();
        let result = tauri::async_runtime::block_on(
            sftp::default_sftp_service().list_directory(&runtime.connection, &parent_path),
        );
        let mut store = self.store.lock()?;
        store.restore_runtime(session_id, runtime);
        let listing = result?;
        store.update_session_current_path(session_id, &listing.canonical_path)?;
        debug_log(
            "navigate_remote_to_parent.done",
            format!(
                "session_id={session_id} elapsed_ms={}",
                started_at.elapsed().as_millis()
            ),
        );
        Ok(store.snapshot())
    }

    /// Uploads a local file into the current remote workspace.
    pub fn upload_file_to_remote(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.upload_file_to_remote(session_id, local_path, remote_path)?;
        Ok(store.snapshot())
    }

    /// Downloads a remote file into a local target path.
    pub fn download_file_from_remote(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.download_file_from_remote(session_id, remote_path, local_path)?;
        Ok(store.snapshot())
    }

    /// Creates a remote directory for the active SFTP session.
    pub fn create_remote_directory(
        &self,
        session_id: &str,
        path: &str,
    ) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.create_remote_directory(session_id, path)?;
        Ok(store.snapshot())
    }

    /// Renames a remote file-system entry for the active SFTP session.
    pub fn rename_remote_entry(
        &self,
        session_id: &str,
        path: &str,
        target_path: &str,
    ) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.rename_remote_entry(session_id, path, target_path)?;
        Ok(store.snapshot())
    }

    /// Deletes a remote file-system entry for the active SFTP session.
    pub fn delete_remote_entry(
        &self,
        session_id: &str,
        path: &str,
        is_directory: bool,
    ) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.delete_remote_entry(session_id, path, is_directory)?;
        Ok(store.snapshot())
    }

    /// Retries a previously failed transfer task by creating a new transfer attempt.
    pub fn retry_transfer_task(&self, task_id: &str) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.retry_transfer_task(task_id)?;
        Ok(store.snapshot())
    }

    /// Removes finished transfer tasks while keeping actively running tasks visible.
    pub fn clear_completed_transfer_tasks(&self) -> AppResult<BootstrapState> {
        let mut store = self.store.lock()?;
        store.clear_completed_transfer_tasks();
        Ok(store.snapshot())
    }

    fn spawn_session_reader(
        &self,
        app_handle: AppHandle,
        session_id: String,
        reader_generation: u64,
        mut reader: ChannelReadHalf,
    ) {
        let store = Arc::clone(&self.store);

        tauri::async_runtime::spawn(async move {
            let flush_delay = Duration::from_millis(SESSION_EVENT_FLUSH_DELAY_MS);
            let mut pending_output: Option<SessionOutputEventPayload> = None;

            loop {
                let next_message = if pending_output.is_some() {
                    match tokio::time::timeout(flush_delay, reader.wait()).await {
                        Ok(message) => message,
                        Err(_) => {
                            flush_pending_output_event(&app_handle, &mut pending_output);
                            continue;
                        }
                    }
                } else {
                    reader.wait().await
                };

                let Some(message) = next_message else {
                    break;
                };

                let payload = match store.lock() {
                    Ok(mut guard) => {
                        if !guard.is_reader_generation_current(&session_id, reader_generation) {
                            return;
                        }
                        guard.apply_terminal_event(&session_id, message)
                    }
                    Err(_) => None,
                };

                if let Some(payload) = payload {
                    match payload {
                        SessionUiEvent::Output(output) => {
                            if let Some(flushed) =
                                merge_pending_output_event(&mut pending_output, output)
                            {
                                emit_session_event(&app_handle, flushed);
                            }
                        }
                        SessionUiEvent::Status(status) => {
                            flush_pending_output_event(&app_handle, &mut pending_output);
                            emit_session_event(&app_handle, SessionUiEvent::Status(status));
                        }
                    }
                }
            }

            flush_pending_output_event(&app_handle, &mut pending_output);

            if let Ok(mut guard) = store.lock() {
                if guard.is_reader_generation_current(&session_id, reader_generation) {
                    if let Some(payload) = guard
                        .mark_session_disconnected(&session_id, "\r\n[TermoraX] SSH 连接已断开。")
                    {
                        emit_session_event(&app_handle, payload);
                    }
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
    transfers: Vec<TransferTask>,
    runtimes: HashMap<String, LiveSessionRuntime>,
    reader_generations: HashMap<String, u64>,
    next_reader_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RetryTransferRequest {
    session_id: String,
    direction: String,
    local_path: String,
    remote_path: String,
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
        let persisted = PersistedState {
            settings: persisted.settings.normalize(),
            ..persisted
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
            transfers: Vec::new(),
            runtimes: HashMap::new(),
            reader_generations: HashMap::new(),
            next_reader_generation: 1,
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
            transfers: self.transfers.clone(),
        }
    }

    fn validate_connection_profile(
        &self,
        profile: ConnectionProfile,
    ) -> AppResult<ConnectionValidationResult> {
        connections::validate_profile(profile, &self.persisted.connections)
    }

    fn test_connection_profile(
        &self,
        profile: ConnectionProfile,
    ) -> AppResult<ConnectionTestResult> {
        let result = connections::simulate_connection_test(profile, &self.persisted.connections)?;
        ssh::default_ssh_service().prepare_connection_from_profile(&result.normalized_profile)?;
        Ok(result)
    }

    fn import_connection_profiles_json(
        &mut self,
        payload: &str,
    ) -> AppResult<ConnectionImportResult> {
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
        let removed_session_ids = self
            .sessions
            .iter()
            .filter(|item| item.connection_id == connection_id)
            .map(|item| item.id.clone())
            .collect::<Vec<_>>();
        self.persisted
            .connections
            .retain(|item| item.id != connection_id);
        self.sessions
            .retain(|item| item.connection_id != connection_id);
        for session_id in removed_session_ids {
            self.runtimes.remove(&session_id);
            self.reader_generations.remove(&session_id);
        }
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
        self.persisted.settings = settings.normalize();
        self.record_activity("已保存工作台设置。".into());
        self.persist()
    }

    fn reset_settings(&mut self) -> AppResult<()> {
        self.persisted.settings = crate::models::AppSettings::default();
        self.record_activity("已重置工作台设置。".into());
        self.persist()
    }

    fn trust_connection_host(
        &mut self,
        connection: &ConnectionProfile,
        inspected_host: &ssh::InspectedSshHostKey,
    ) -> AppResult<HostFingerprintInspection> {
        let trusted_at = now_iso();
        upsert_trusted_host(
            &mut self.persisted.trusted_hosts,
            TrustedHost {
                host: connection.host.clone(),
                port: connection.port,
                algorithm: inspected_host.algorithm.clone(),
                fingerprint: inspected_host.fingerprint.clone(),
                trusted_at,
            },
        );
        self.record_activity(format!(
            "已信任主机 {}:{} 的 SSH 指纹。",
            connection.host, connection.port
        ));
        self.persist()?;

        Ok(build_host_fingerprint_inspection(
            connection,
            inspected_host,
            self.find_trusted_host(&connection.host, connection.port),
        ))
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

        let session_title = sessions::next_session_title(&self.sessions, &connection.name);
        let session = sessions::open_connected_session(
            connection,
            session_title,
            format!(
                "已连接到 {}@{}:{}\r\n\r\n",
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
        self.bump_reader_generation(&session_id);
        self.sessions.insert(0, session);
        self.record_activity(format!("已为 {} 打开会话。", connection.name));
        self.persist()?;

        Ok(session_id)
    }

    fn close_session(&mut self, session_id: &str) -> AppResult<Option<LiveSessionRuntime>> {
        let session_title = sessions::close_session(&mut self.sessions, session_id)?;
        let runtime = self.runtimes.remove(session_id);
        self.reader_generations.remove(session_id);
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
            session.current_path = Some("/".into());
            session.last_output = format!(
                "已重新连接到 {}@{}:{}\r\n\r\n",
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
        self.bump_reader_generation(session_id);
        self.record_activity(format!("已重新连接会话 {}。", session_title));
        self.persist()
    }

    fn take_runtime(&mut self, session_id: &str) -> AppResult<LiveSessionRuntime> {
        self.runtimes
            .remove(session_id)
            .ok_or_else(|| AppError::new("session_not_connected", "当前会话尚未建立实时 SSH 连接"))
    }

    fn restore_runtime(&mut self, session_id: &str, runtime: LiveSessionRuntime) {
        self.runtimes.insert(session_id.to_string(), runtime);
    }

    fn update_session_current_path(
        &mut self,
        session_id: &str,
        current_path: &str,
    ) -> AppResult<()> {
        let session = self
            .sessions
            .iter_mut()
            .find(|item| item.id == session_id)
            .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;
        session.current_path = Some(current_path.to_string());
        session.updated_at = now_iso();
        Ok(())
    }

    fn bump_reader_generation(&mut self, session_id: &str) -> u64 {
        let generation = self.next_reader_generation;
        self.next_reader_generation = self.next_reader_generation.saturating_add(1);
        self.reader_generations
            .insert(session_id.to_string(), generation);
        generation
    }

    fn current_reader_generation(&self, session_id: &str) -> AppResult<u64> {
        self.reader_generations
            .get(session_id)
            .copied()
            .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))
    }

    fn is_reader_generation_current(&self, session_id: &str, generation: u64) -> bool {
        self.reader_generations.get(session_id).copied() == Some(generation)
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
            self.reader_generations.remove(&removed_id);
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

    fn upload_file_to_remote(
        &mut self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> AppResult<()> {
        let local_path_ref = Path::new(local_path);
        let file_size = fs::metadata(local_path_ref)?.len();
        let task_id =
            self.start_transfer_task(session_id, "upload", local_path, remote_path, file_size);
        let runtime = self.runtimes.get(session_id).ok_or_else(|| {
            AppError::new("session_not_connected", "当前会话尚未建立实时 SSH 连接")
        })?;

        match tauri::async_runtime::block_on(sftp::default_sftp_service().upload_file(
            &runtime.connection,
            local_path_ref,
            remote_path,
        )) {
            Ok(bytes_transferred) => {
                self.finish_transfer_task_success(&task_id, bytes_transferred);
                self.record_activity(format!(
                    "已上传文件 {} -> {}。",
                    local_path_ref.display(),
                    remote_path
                ));
                Ok(())
            }
            Err(error) => {
                self.finish_transfer_task_failure(&task_id, error.message.clone());
                Err(error)
            }
        }
    }

    fn download_file_from_remote(
        &mut self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> AppResult<()> {
        let local_path_ref = Path::new(local_path);
        let task_id = self.start_transfer_task(session_id, "download", local_path, remote_path, 0);
        let runtime = self.runtimes.get(session_id).ok_or_else(|| {
            AppError::new("session_not_connected", "当前会话尚未建立实时 SSH 连接")
        })?;

        match tauri::async_runtime::block_on(sftp::default_sftp_service().download_file(
            &runtime.connection,
            remote_path,
            local_path_ref,
        )) {
            Ok(bytes_transferred) => {
                self.finish_transfer_task_success(&task_id, bytes_transferred);
                self.record_activity(format!(
                    "已下载文件 {} -> {}。",
                    remote_path,
                    local_path_ref.display()
                ));
                Ok(())
            }
            Err(error) => {
                self.finish_transfer_task_failure(&task_id, error.message.clone());
                Err(error)
            }
        }
    }

    fn create_remote_directory(&mut self, session_id: &str, path: &str) -> AppResult<()> {
        let runtime = self.runtimes.get(session_id).ok_or_else(|| {
            AppError::new("session_not_connected", "当前会话尚未建立实时 SSH 连接")
        })?;

        tauri::async_runtime::block_on(
            sftp::default_sftp_service().create_directory(&runtime.connection, path),
        )?;
        self.record_activity(format!("已创建远程目录 {}。", path));
        Ok(())
    }

    fn rename_remote_entry(
        &mut self,
        session_id: &str,
        path: &str,
        target_path: &str,
    ) -> AppResult<()> {
        let runtime = self.runtimes.get(session_id).ok_or_else(|| {
            AppError::new("session_not_connected", "当前会话尚未建立实时 SSH 连接")
        })?;

        tauri::async_runtime::block_on(sftp::default_sftp_service().rename_path(
            &runtime.connection,
            path,
            target_path,
        ))?;
        self.record_activity(format!("已重命名远程路径 {} -> {}。", path, target_path));
        Ok(())
    }

    fn delete_remote_entry(
        &mut self,
        session_id: &str,
        path: &str,
        is_directory: bool,
    ) -> AppResult<()> {
        let runtime = self.runtimes.get(session_id).ok_or_else(|| {
            AppError::new("session_not_connected", "当前会话尚未建立实时 SSH 连接")
        })?;

        if is_directory {
            tauri::async_runtime::block_on(
                sftp::default_sftp_service().delete_directory(&runtime.connection, path),
            )?;
            self.record_activity(format!("已删除远程目录 {}。", path));
        } else {
            tauri::async_runtime::block_on(
                sftp::default_sftp_service().delete_file(&runtime.connection, path),
            )?;
            self.record_activity(format!("已删除远程文件 {}。", path));
        }

        Ok(())
    }

    fn retry_transfer_task(&mut self, task_id: &str) -> AppResult<()> {
        let request = self.build_retry_transfer_request(task_id)?;

        match request.direction.as_str() {
            "upload" => self.upload_file_to_remote(
                &request.session_id,
                &request.local_path,
                &request.remote_path,
            ),
            "download" => self.download_file_from_remote(
                &request.session_id,
                &request.remote_path,
                &request.local_path,
            ),
            _ => Err(AppError::new(
                "transfer_task_invalid_direction",
                "传输任务方向无效，无法重试",
            )),
        }
    }

    fn clear_completed_transfer_tasks(&mut self) {
        let before = self.transfers.len();
        self.transfers.retain(|task| task.status == "running");
        let removed = before.saturating_sub(self.transfers.len());

        if removed > 0 {
            self.record_activity(format!("已清理 {} 个已完成传输任务。", removed));
        }
    }

    fn find_connection(&self, connection_id: &str) -> AppResult<&ConnectionProfile> {
        self.persisted
            .connections
            .iter()
            .find(|item| item.id == connection_id)
            .ok_or_else(|| AppError::new("connection_not_found", connection_id.to_string()))
    }

    fn find_trusted_host(&self, host: &str, port: u16) -> Option<&TrustedHost> {
        self.persisted
            .trusted_hosts
            .iter()
            .find(|item| item.host == host && item.port == port)
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
                &format!(
                    "\r\n[TermoraX] 远端会话因信号 {:?} 结束：{}",
                    signal_name, error_message
                ),
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
        let session_title = sessions::set_session_status(
            &mut self.sessions,
            session_id,
            "disconnected",
            Some(message),
        )
        .ok()?;
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

    fn start_transfer_task(
        &mut self,
        session_id: &str,
        direction: &str,
        local_path: &str,
        remote_path: &str,
        bytes_total: u64,
    ) -> String {
        let task_id = next_id("transfer");
        self.transfers.insert(
            0,
            TransferTask {
                id: task_id.clone(),
                session_id: session_id.to_string(),
                direction: direction.to_string(),
                status: "running".into(),
                local_path: local_path.to_string(),
                remote_path: remote_path.to_string(),
                bytes_total,
                bytes_transferred: 0,
                started_at: now_iso(),
                finished_at: None,
                message: None,
            },
        );
        self.transfers.truncate(50);
        task_id
    }

    fn finish_transfer_task_success(&mut self, task_id: &str, bytes_transferred: u64) {
        if let Some(task) = self.transfers.iter_mut().find(|item| item.id == task_id) {
            task.status = "succeeded".into();
            task.bytes_transferred = bytes_transferred;
            if task.bytes_total == 0 {
                task.bytes_total = bytes_transferred;
            }
            task.finished_at = Some(now_iso());
            task.message = None;
        }
    }

    fn finish_transfer_task_failure(&mut self, task_id: &str, message: String) {
        if let Some(task) = self.transfers.iter_mut().find(|item| item.id == task_id) {
            task.status = "failed".into();
            task.finished_at = Some(now_iso());
            task.message = Some(message);
        }
    }

    // Retry is only valid for finished failed tasks. The returned request is
    // separated from execution so validation can be tested without a live SSH runtime.
    fn build_retry_transfer_request(&self, task_id: &str) -> AppResult<RetryTransferRequest> {
        let task = self
            .transfers
            .iter()
            .find(|item| item.id == task_id)
            .ok_or_else(|| AppError::new("transfer_task_not_found", task_id.to_string()))?;

        if task.status != "failed" {
            return Err(AppError::new(
                "transfer_task_not_retryable",
                "仅失败的传输任务支持重试",
            ));
        }

        Ok(RetryTransferRequest {
            session_id: task.session_id.clone(),
            direction: task.direction.clone(),
            local_path: task.local_path.clone(),
            remote_path: task.remote_path.clone(),
        })
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

fn upsert_trusted_host(items: &mut Vec<TrustedHost>, next: TrustedHost) {
    if let Some(index) = items
        .iter()
        .position(|item| item.host == next.host && item.port == next.port)
    {
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

fn debug_log(event: &str, message: impl AsRef<str>) {
    if cfg!(debug_assertions) {
        println!(
            "[termorax][app_state][{:?}] {} {}",
            std::thread::current().id(),
            event,
            message.as_ref()
        );
    }
}

fn ensure_trust_request_matches(
    fingerprint: &str,
    inspected_host: &ssh::InspectedSshHostKey,
) -> AppResult<()> {
    let requested_fingerprint = fingerprint.trim();
    if requested_fingerprint.is_empty() {
        return Err(AppError::new(
            "ssh_host_fingerprint_required",
            "主机指纹不能为空",
        ));
    }

    if requested_fingerprint != inspected_host.fingerprint {
        return Err(AppError::new(
            "ssh_host_fingerprint_stale",
            format!(
                "主机指纹已变化，请重新确认。当前为 {}",
                inspected_host.fingerprint
            ),
        ));
    }

    Ok(())
}

fn build_host_fingerprint_inspection(
    connection: &ConnectionProfile,
    inspected_host: &ssh::InspectedSshHostKey,
    trusted_host: Option<&TrustedHost>,
) -> HostFingerprintInspection {
    let (trust_status, trusted_fingerprint) = match trusted_host {
        Some(trusted_host) if trusted_host.fingerprint == inspected_host.fingerprint => {
            ("trusted".into(), Some(trusted_host.fingerprint.clone()))
        }
        Some(trusted_host) => ("mismatch".into(), Some(trusted_host.fingerprint.clone())),
        None => ("requiresTrust".into(), None),
    };

    HostFingerprintInspection {
        connection_id: connection.id.clone(),
        host: connection.host.clone(),
        port: connection.port,
        algorithm: inspected_host.algorithm.clone(),
        fingerprint: inspected_host.fingerprint.clone(),
        trust_status,
        trusted_fingerprint,
        inspected_at: now_iso(),
    }
}

fn parent_remote_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/".into();
    }

    let normalized = trimmed.trim_end_matches('/');
    match normalized.rsplit_once('/') {
        Some(("", _)) | None => "/".into(),
        Some((parent, _)) => parent.to_string(),
    }
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

fn merge_pending_output_event(
    pending_output: &mut Option<SessionOutputEventPayload>,
    next_output: SessionOutputEventPayload,
) -> Option<SessionUiEvent> {
    match pending_output {
        Some(current)
            if current.stream == next_output.stream
                && current.chunk.len() + next_output.chunk.len()
                    <= MAX_BATCHED_SESSION_OUTPUT_CHARS =>
        {
            current.chunk.push_str(&next_output.chunk);
            current.occurred_at = next_output.occurred_at;
            None
        }
        Some(_) => {
            let flushed = pending_output.take().map(SessionUiEvent::Output);
            *pending_output = Some(next_output);
            flushed
        }
        None => {
            *pending_output = Some(next_output);
            None
        }
    }
}

fn flush_pending_output_event(
    app_handle: &AppHandle,
    pending_output: &mut Option<SessionOutputEventPayload>,
) {
    if let Some(output) = pending_output.take() {
        emit_session_event(app_handle, SessionUiEvent::Output(output));
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::PathBuf};

    use super::{
        build_host_fingerprint_inspection, ensure_trust_request_matches,
        merge_pending_output_event, parent_remote_path, AppState, AppStore,
        MAX_BATCHED_SESSION_OUTPUT_CHARS,
    };
    use crate::{
        events::SessionOutputEventPayload,
        models::{ConnectionProfile, TrustedHost},
        services::ssh::InspectedSshHostKey,
    };

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

    fn inspected_host(fingerprint: &str) -> InspectedSshHostKey {
        InspectedSshHostKey {
            algorithm: "ssh-ed25519".into(),
            fingerprint: fingerprint.into(),
        }
    }

    fn output_payload(chunk: &str, stream: &'static str) -> SessionOutputEventPayload {
        SessionOutputEventPayload {
            kind: "output",
            session_id: "session-1".into(),
            stream,
            chunk: chunk.into(),
            occurred_at: "1".into(),
        }
    }

    #[test]
    fn app_state_imports_and_exports_profiles() {
        let dir = temp_config_dir("import-export");
        let state = AppState::new(dir).expect("state should initialize");
        let payload = serde_json::to_string(&vec![profile("conn-test-import")])
            .expect("json should serialize");

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
    fn app_store_loads_legacy_state_without_trusted_hosts() {
        let dir = temp_config_dir("legacy-trusted-hosts");
        fs::write(
            dir.join("workspace-state.json"),
            r#"{
              "connections": [],
              "snippets": [],
              "settings": {
                "terminal": {
                  "fontFamily": "JetBrains Mono",
                  "fontSize": 14,
                  "lineHeight": 1.6,
                  "theme": "midnight",
                  "cursorStyle": "block",
                  "copyOnSelect": false
                },
                "workspace": {
                  "sidebarCollapsed": false,
                  "rightPanel": "files",
                  "rightPanelVisible": true
                }
              }
            }"#,
        )
        .expect("legacy state should be written");

        let store = AppStore::load(dir).expect("legacy state should load");

        assert!(store.persisted.trusted_hosts.is_empty());
        assert_eq!(store.persisted.settings.terminal.theme, "midnight");
        assert_eq!(store.persisted.settings.workspace.bottom_panel, "files");
        assert!(store.persisted.settings.workspace.bottom_panel_visible);
        assert_eq!(store.persisted.settings.workspace.side_panel, "activity");
        assert!(store.persisted.settings.workspace.side_panel_visible);
    }

    #[test]
    fn app_store_normalizes_legacy_snippet_panel_and_unknown_theme() {
        let dir = temp_config_dir("legacy-theme-bottom-panel");
        fs::write(
            dir.join("workspace-state.json"),
            r#"{
              "connections": [],
              "snippets": [],
              "settings": {
                "terminal": {
                  "fontFamily": "JetBrains Mono",
                  "fontSize": 14,
                  "lineHeight": 1.6,
                  "theme": "aurora",
                  "cursorStyle": "block",
                  "copyOnSelect": false
                },
                "workspace": {
                  "sidebarCollapsed": false,
                  "rightPanel": "snippets",
                  "rightPanelVisible": true
                }
              }
            }"#,
        )
        .expect("legacy state should be written");

        let store = AppStore::load(dir).expect("legacy state should load");

        assert_eq!(store.persisted.settings.terminal.theme, "midnight");
        assert_eq!(store.persisted.settings.workspace.bottom_panel, "snippets");
        assert!(store.persisted.settings.workspace.bottom_panel_visible);
        assert_eq!(store.persisted.settings.workspace.side_panel, "activity");
        assert!(store.persisted.settings.workspace.side_panel_visible);
    }

    #[test]
    fn trust_request_requires_matching_current_fingerprint() {
        let empty_error = ensure_trust_request_matches("  ", &inspected_host("SHA256:current"))
            .expect_err("blank trust fingerprint should fail");
        assert_eq!(empty_error.code, "ssh_host_fingerprint_required");

        let stale_error =
            ensure_trust_request_matches("SHA256:old", &inspected_host("SHA256:current"))
                .expect_err("stale trust fingerprint should fail");
        assert_eq!(stale_error.code, "ssh_host_fingerprint_stale");

        ensure_trust_request_matches("SHA256:current", &inspected_host("SHA256:current"))
            .expect("current fingerprint should pass");
    }

    #[test]
    fn host_fingerprint_inspection_reports_trust_status() {
        let connection = profile("conn-trust-status");
        let trusted = build_host_fingerprint_inspection(
            &connection,
            &inspected_host("SHA256:current"),
            Some(&TrustedHost {
                host: connection.host.clone(),
                port: connection.port,
                algorithm: "ssh-ed25519".into(),
                fingerprint: "SHA256:current".into(),
                trusted_at: "1".into(),
            }),
        );
        let mismatch = build_host_fingerprint_inspection(
            &connection,
            &inspected_host("SHA256:new"),
            Some(&TrustedHost {
                host: connection.host.clone(),
                port: connection.port,
                algorithm: "ssh-ed25519".into(),
                fingerprint: "SHA256:old".into(),
                trusted_at: "1".into(),
            }),
        );
        let untrusted =
            build_host_fingerprint_inspection(&connection, &inspected_host("SHA256:new"), None);

        assert_eq!(trusted.trust_status, "trusted");
        assert_eq!(mismatch.trust_status, "mismatch");
        assert_eq!(mismatch.trusted_fingerprint.as_deref(), Some("SHA256:old"));
        assert_eq!(untrusted.trust_status, "requiresTrust");
    }

    #[test]
    fn trust_connection_replaces_existing_host_entry() {
        let dir = temp_config_dir("trusted-host-upsert");
        let mut store = AppStore::load(dir).expect("store should initialize");
        let connection = profile("conn-trusted-host");

        store
            .trust_connection_host(&connection, &inspected_host("SHA256:first"))
            .expect("first trust should succeed");
        store
            .trust_connection_host(&connection, &inspected_host("SHA256:second"))
            .expect("second trust should replace prior entry");

        assert_eq!(store.persisted.trusted_hosts.len(), 1);
        assert_eq!(
            store.persisted.trusted_hosts[0].fingerprint,
            "SHA256:second"
        );
    }

    #[test]
    fn transfer_tasks_track_success_and_failure_states() {
        let dir = temp_config_dir("transfer-lifecycle");
        let mut store = AppStore::load(dir).expect("store should initialize");

        let upload_task_id = store.start_transfer_task(
            "session-1",
            "upload",
            "C:/tmp/demo.log",
            "/home/demo/demo.log",
            128,
        );
        let download_task_id = store.start_transfer_task(
            "session-1",
            "download",
            "D:/backup/demo.log",
            "/srv/demo.log",
            0,
        );

        store.finish_transfer_task_success(&upload_task_id, 128);
        store.finish_transfer_task_failure(&download_task_id, "download failed".into());

        let upload_task = store
            .transfers
            .iter()
            .find(|task| task.id == upload_task_id)
            .expect("upload task should exist");
        assert_eq!(upload_task.status, "succeeded");
        assert_eq!(upload_task.bytes_total, 128);
        assert_eq!(upload_task.bytes_transferred, 128);
        assert!(upload_task.finished_at.is_some());
        assert_eq!(upload_task.message, None);

        let download_task = store
            .transfers
            .iter()
            .find(|task| task.id == download_task_id)
            .expect("download task should exist");
        assert_eq!(download_task.status, "failed");
        assert_eq!(download_task.bytes_total, 0);
        assert_eq!(download_task.bytes_transferred, 0);
        assert!(download_task.finished_at.is_some());
        assert_eq!(download_task.message.as_deref(), Some("download failed"));
    }

    #[test]
    fn transfer_tasks_keep_recent_history_window() {
        let dir = temp_config_dir("transfer-history");
        let mut store = AppStore::load(dir).expect("store should initialize");

        for index in 0..55 {
            let local_path = format!("C:/tmp/file-{}.txt", index);
            let remote_path = format!("/srv/file-{}.txt", index);
            let _ = store.start_transfer_task("session-1", "upload", &local_path, &remote_path, 32);
        }

        assert_eq!(store.transfers.len(), 50);
        assert_eq!(store.transfers[0].local_path, "C:/tmp/file-54.txt");
        assert_eq!(store.transfers[49].local_path, "C:/tmp/file-5.txt");
    }

    #[test]
    fn retry_transfer_request_requires_failed_task() {
        let dir = temp_config_dir("transfer-retryable");
        let mut store = AppStore::load(dir).expect("store should initialize");

        let failed_task_id = store.start_transfer_task(
            "session-1",
            "upload",
            "C:/tmp/demo.log",
            "/home/demo/demo.log",
            128,
        );
        store.finish_transfer_task_failure(&failed_task_id, "failed".into());
        let running_task_id = store.start_transfer_task(
            "session-1",
            "download",
            "D:/tmp/demo.log",
            "/srv/demo.log",
            128,
        );

        let request = store
            .build_retry_transfer_request(&failed_task_id)
            .expect("failed task should be retryable");
        assert_eq!(request.session_id, "session-1");
        assert_eq!(request.direction, "upload");
        assert_eq!(request.local_path, "C:/tmp/demo.log");
        assert_eq!(request.remote_path, "/home/demo/demo.log");

        let error = store
            .build_retry_transfer_request(&running_task_id)
            .expect_err("running task should not be retryable");
        assert_eq!(error.code, "transfer_task_not_retryable");

        let missing = store
            .build_retry_transfer_request("missing-task")
            .expect_err("missing task should fail");
        assert_eq!(missing.code, "transfer_task_not_found");
    }

    #[test]
    fn clear_completed_transfer_tasks_keeps_running_only() {
        let dir = temp_config_dir("transfer-clear-completed");
        let mut store = AppStore::load(dir).expect("store should initialize");

        let running_task_id = store.start_transfer_task(
            "session-1",
            "upload",
            "C:/tmp/live.log",
            "/home/demo/live.log",
            32,
        );
        let succeeded_task_id = store.start_transfer_task(
            "session-1",
            "upload",
            "C:/tmp/done.log",
            "/home/demo/done.log",
            64,
        );
        store.finish_transfer_task_success(&succeeded_task_id, 64);
        let failed_task_id = store.start_transfer_task(
            "session-1",
            "download",
            "D:/tmp/fail.log",
            "/srv/fail.log",
            0,
        );
        store.finish_transfer_task_failure(&failed_task_id, "failed".into());

        store.clear_completed_transfer_tasks();

        assert_eq!(store.transfers.len(), 1);
        assert_eq!(store.transfers[0].id, running_task_id);
        assert_eq!(store.transfers[0].status, "running");
        assert!(store
            .activity
            .iter()
            .any(|entry| entry.title.contains("已清理 2 个已完成传输任务")));
    }

    #[test]
    fn parent_remote_path_handles_root_and_nested_directories() {
        assert_eq!(parent_remote_path("/"), "/");
        assert_eq!(parent_remote_path(""), "/");
        assert_eq!(parent_remote_path("/home"), "/");
        assert_eq!(parent_remote_path("/home/demo"), "/home");
        assert_eq!(parent_remote_path("/home/demo/"), "/home");
    }

    #[test]
    fn merge_pending_output_event_appends_same_stream_chunks() {
        let mut pending = Some(output_payload("hello", "stdout"));

        let flushed = merge_pending_output_event(&mut pending, output_payload(" world", "stdout"));

        assert!(flushed.is_none());
        assert_eq!(
            pending.expect("pending output should exist").chunk,
            "hello world"
        );
    }

    #[test]
    fn merge_pending_output_event_flushes_when_stream_changes() {
        let mut pending = Some(output_payload("hello", "stdout"));

        let flushed = merge_pending_output_event(&mut pending, output_payload("oops", "stderr"));

        let flushed = flushed.expect("previous output should flush");
        match flushed {
            super::SessionUiEvent::Output(payload) => {
                assert_eq!(payload.chunk, "hello");
                assert_eq!(payload.stream, "stdout");
            }
            super::SessionUiEvent::Status(_) => panic!("expected output event"),
        }
        assert_eq!(
            pending.expect("stderr output should remain pending").chunk,
            "oops"
        );
    }

    #[test]
    fn merge_pending_output_event_flushes_when_chunk_budget_is_exceeded() {
        let prefix = "a".repeat(MAX_BATCHED_SESSION_OUTPUT_CHARS);
        let mut pending = Some(output_payload(&prefix, "stdout"));

        let flushed = merge_pending_output_event(&mut pending, output_payload("b", "stdout"));

        let flushed = flushed.expect("full pending buffer should flush");
        match flushed {
            super::SessionUiEvent::Output(payload) => {
                assert_eq!(payload.chunk.len(), MAX_BATCHED_SESSION_OUTPUT_CHARS);
            }
            super::SessionUiEvent::Status(_) => panic!("expected output event"),
        }
        assert_eq!(
            pending.expect("overflow chunk should remain pending").chunk,
            "b"
        );
    }
}
