use tauri::State;

use crate::{
    error::AppResult,
    models::{
        AppSettings, BootstrapState, CommandSnippet, ConnectionExportResult, ConnectionImportResult,
        ConnectionProfile, ConnectionTestResult, ConnectionValidationResult, RemoteFileEntry,
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

#[tauri::command]
pub fn open_session(state: State<'_, AppState>, connection_id: String) -> AppResult<BootstrapState> {
    state.open_session(&connection_id)
}

#[tauri::command]
pub fn close_session(state: State<'_, AppState>, session_id: String) -> AppResult<BootstrapState> {
    state.close_session(&session_id)
}

/// Reconnects an existing simulated session.
#[tauri::command]
pub fn reconnect_session(state: State<'_, AppState>, session_id: String) -> AppResult<BootstrapState> {
    state.reconnect_session(&session_id)
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
