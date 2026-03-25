use tauri::Manager;

use crate::{
    commands,
    services::app_state::AppState,
};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            app.manage(AppState::new(config_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap_state,
            commands::validate_connection_profile,
            commands::test_connection_profile,
            commands::import_connection_profiles_json,
            commands::export_connection_profiles_json,
            commands::save_connection_profile,
            commands::delete_connection_profile,
            commands::save_command_snippet,
            commands::delete_command_snippet,
            commands::save_settings,
            commands::reset_settings,
            commands::open_session,
            commands::close_session,
            commands::reconnect_session,
            commands::clear_session_output,
            commands::close_other_sessions,
            commands::resize_session,
            commands::send_session_input,
            commands::run_snippet_on_session,
            commands::list_remote_entries
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
