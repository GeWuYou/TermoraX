use tauri::{AppHandle, State};

use crate::{
    error::AppResult,
    models::{
        AppSettings, BootstrapState, CommandSnippet, ConnectionExportResult, ConnectionImportResult,
        ConnectionProfile, ConnectionTestResult, ConnectionValidationResult, HostFingerprintInspection,
        RemoteFileEntry,
    },
    services::app_state::AppState,
};

/// Returns the bootstrap snapshot required by the frontend shell.
#[tauri::command]
pub fn get_bootstrap_state(state: State<'_, AppState>) -> AppResult<BootstrapState> {
    state.snapshot()
}

/// Validates and normalizes a connection profile without persisting it.
#[tauri::command]
pub fn validate_connection_profile(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
) -> AppResult<ConnectionValidationResult> {
    state.validate_connection_profile(profile)
}

/// Simulates a P0 connection test and returns validation-centric feedback.
#[tauri::command]
pub fn test_connection_profile(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
) -> AppResult<ConnectionTestResult> {
    state.test_connection_profile(profile)
}

/// Imports connection profiles from a JSON string owned by the backend boundary.
#[tauri::command]
pub fn import_connection_profiles_json(
    state: State<'_, AppState>,
    payload: String,
) -> AppResult<ConnectionImportResult> {
    state.import_connection_profiles_json(&payload)
}

/// Exports all connection profiles as a JSON string.
#[tauri::command]
pub fn export_connection_profiles_json(
    state: State<'_, AppState>,
) -> AppResult<ConnectionExportResult> {
    state.export_connection_profiles_json()
}

/// Saves a connection profile after backend-side normalization and validation.
#[tauri::command]
pub fn save_connection_profile(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
) -> AppResult<BootstrapState> {
    state.save_connection_profile(profile)
}

#[tauri::command]
pub fn delete_connection_profile(
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<BootstrapState> {
    state.delete_connection_profile(&connection_id)
}

#[tauri::command]
pub fn save_command_snippet(
    state: State<'_, AppState>,
    snippet: CommandSnippet,
) -> AppResult<BootstrapState> {
    state.save_command_snippet(snippet)
}

#[tauri::command]
pub fn delete_command_snippet(
    state: State<'_, AppState>,
    snippet_id: String,
) -> AppResult<BootstrapState> {
    state.delete_command_snippet(&snippet_id)
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> AppResult<BootstrapState> {
    state.save_settings(settings)
}

#[tauri::command]
pub fn reset_settings(state: State<'_, AppState>) -> AppResult<BootstrapState> {
    state.reset_settings()
}

/// Inspects the current SSH host fingerprint for a saved connection.
#[tauri::command]
pub fn inspect_connection_host(
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<HostFingerprintInspection> {
    state.inspect_connection_host(&connection_id)
}

/// Stores the currently inspected fingerprint as a trusted host entry.
#[tauri::command]
pub fn trust_connection_host(
    state: State<'_, AppState>,
    connection_id: String,
    fingerprint: String,
) -> AppResult<HostFingerprintInspection> {
    state.trust_connection_host(&connection_id, &fingerprint)
}

#[tauri::command]
pub fn open_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<BootstrapState> {
    state.open_session(&app_handle, &connection_id)
}

#[tauri::command]
pub fn close_session(state: State<'_, AppState>, session_id: String) -> AppResult<BootstrapState> {
    state.close_session(&session_id)
}

/// Reconnects an existing simulated session.
#[tauri::command]
pub fn reconnect_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<BootstrapState> {
    state.reconnect_session(&app_handle, &session_id)
}

/// Clears the output transcript for a simulated session.
#[tauri::command]
pub fn clear_session_output(state: State<'_, AppState>, session_id: String) -> AppResult<BootstrapState> {
    state.clear_session_output(&session_id)
}

/// Closes every session except the target session.
#[tauri::command]
pub fn close_other_sessions(state: State<'_, AppState>, session_id: String) -> AppResult<BootstrapState> {
    state.close_other_sessions(&session_id)
}

/// Resizes the terminal metadata tracked for a simulated session.
#[tauri::command]
pub fn resize_session(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> AppResult<BootstrapState> {
    state.resize_session(&session_id, cols, rows)
}

#[tauri::command]
pub fn send_session_input(
    state: State<'_, AppState>,
    session_id: String,
    input: String,
) -> AppResult<BootstrapState> {
    state.send_session_input(&session_id, &input)
}

#[tauri::command]
pub fn run_snippet_on_session(
    state: State<'_, AppState>,
    session_id: String,
    snippet_id: String,
) -> AppResult<BootstrapState> {
    state.run_snippet_on_session(&session_id, &snippet_id)
}

#[tauri::command]
pub fn list_remote_entries(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<Vec<RemoteFileEntry>> {
    state.list_remote_entries(&session_id)
}

/// Navigates a live session to a specific remote directory path.
#[tauri::command]
pub fn navigate_remote_directory(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<BootstrapState> {
    state.navigate_remote_directory(&session_id, &path)
}

/// Navigates a live session to the parent remote directory.
#[tauri::command]
pub fn navigate_remote_to_parent(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<BootstrapState> {
    state.navigate_remote_to_parent(&session_id)
}

/// Uploads a local file into a remote target path.
#[tauri::command]
pub fn upload_file_to_remote(
    state: State<'_, AppState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> AppResult<BootstrapState> {
    state.upload_file_to_remote(&session_id, &local_path, &remote_path)
}

/// Downloads a remote file into a local target path.
#[tauri::command]
pub fn download_file_from_remote(
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> AppResult<BootstrapState> {
    state.download_file_from_remote(&session_id, &remote_path, &local_path)
}

/// Creates a remote directory inside the current SFTP workspace.
#[tauri::command]
pub fn create_remote_directory(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<BootstrapState> {
    state.create_remote_directory(&session_id, &path)
}

/// Renames a remote file-system entry.
#[tauri::command]
pub fn rename_remote_entry(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    target_path: String,
) -> AppResult<BootstrapState> {
    state.rename_remote_entry(&session_id, &path, &target_path)
}

/// Deletes a remote file or directory.
#[tauri::command]
pub fn delete_remote_entry(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_directory: bool,
) -> AppResult<BootstrapState> {
    state.delete_remote_entry(&session_id, &path, is_directory)
}

/// Retries a previously failed transfer task.
#[tauri::command]
pub fn retry_transfer_task(
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<BootstrapState> {
    state.retry_transfer_task(&task_id)
}

/// Clears completed transfer tasks from the transfer center.
#[tauri::command]
pub fn clear_completed_transfer_tasks(state: State<'_, AppState>) -> AppResult<BootstrapState> {
    state.clear_completed_transfer_tasks()
}
