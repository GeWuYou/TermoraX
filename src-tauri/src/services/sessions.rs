use crate::{
    error::{AppError, AppResult},
    models::{ConnectionProfile, SessionTab},
};

pub const DEFAULT_TERMINAL_COLS: u16 = 120;
pub const DEFAULT_TERMINAL_ROWS: u16 = 32;

/// Creates a connected SSH session snapshot backed by a real or simulated transport.
pub fn open_connected_session(
    connection: &ConnectionProfile,
    initial_output: String,
    terminal_cols: u16,
    terminal_rows: u16,
) -> SessionTab {
    let now = now_millis();

    SessionTab {
        id: next_id("session"),
        connection_id: connection.id.clone(),
        title: connection.name.clone(),
        protocol: "ssh".into(),
        status: "connected".into(),
        current_path: Some("/".into()),
        last_output: initial_output,
        terminal_cols,
        terminal_rows,
        created_at: now.clone(),
        updated_at: now,
    }
}

/// Creates a new simulated SSH session for the provided connection profile.
#[allow(dead_code)]
pub fn open_simulated_session(connection: &ConnectionProfile) -> SessionTab {
    open_connected_session(
        connection,
        format!(
            "已连接到 {}@{}:{}\n\n[模拟器] SSH 传输层当前仍为桩实现。\n[模拟器] Rust 命令边界、持久化与工作台生命周期已经接通。",
            connection.username, connection.host, connection.port
        ),
        DEFAULT_TERMINAL_COLS,
        DEFAULT_TERMINAL_ROWS,
    )
}

/// Appends simulated terminal input to a session transcript.
#[allow(dead_code)]
pub fn append_simulated_input(sessions: &mut [SessionTab], session_id: &str, input: &str) -> AppResult<String> {
    let session = find_session_mut(sessions, session_id)?;

    session.last_output = format!(
        "{}\n\n$ {}\n[模拟器] Rust 宿主边界已接收该命令。",
        session.last_output,
        input.trim()
    );
    session.updated_at = now_millis();

    Ok(session.title.clone())
}

/// Appends terminal output to an existing session buffer.
pub fn append_session_output(sessions: &mut [SessionTab], session_id: &str, chunk: &str) -> AppResult<()> {
    let session = find_session_mut(sessions, session_id)?;
    session.last_output.push_str(chunk);
    session.updated_at = now_millis();

    Ok(())
}

/// Updates the current status for a tracked session.
pub fn set_session_status(
    sessions: &mut [SessionTab],
    session_id: &str,
    status: &str,
    message: Option<&str>,
) -> AppResult<String> {
    let session = find_session_mut(sessions, session_id)?;
    session.status = status.to_string();
    if let Some(message) = message {
        if !message.is_empty() {
            if !session.last_output.is_empty() {
                session.last_output.push_str("\r\n\r\n");
            }
            session.last_output.push_str(message);
        }
    }
    session.updated_at = now_millis();

    Ok(session.title.clone())
}

/// Reconnects an existing simulated session and appends a reconnect marker.
#[allow(dead_code)]
pub fn reconnect_session(
    sessions: &mut [SessionTab],
    session_id: &str,
    connection: &ConnectionProfile,
) -> AppResult<String> {
    let session = find_session_mut(sessions, session_id)?;
    session.status = "connected".into();
    session.current_path = Some("/".into());
    session.last_output = format!(
        "{}\n\n[模拟器] 已重新连接到 {}@{}:{}。",
        session.last_output, connection.username, connection.host, connection.port
    );
    session.updated_at = now_millis();

    Ok(session.title.clone())
}

/// Clears the simulated output buffer while keeping a minimal marker.
pub fn clear_session_output(sessions: &mut [SessionTab], session_id: &str) -> AppResult<String> {
    let session = find_session_mut(sessions, session_id)?;
    session.last_output = "会话输出已清空。".into();
    session.updated_at = now_millis();

    Ok(session.title.clone())
}

/// Closes every session except the one identified by `session_id`.
pub fn close_other_sessions(sessions: &mut Vec<SessionTab>, session_id: &str) -> AppResult<usize> {
    ensure_session_exists(sessions, session_id)?;
    let initial_len = sessions.len();
    sessions.retain(|session| session.id == session_id);

    Ok(initial_len.saturating_sub(sessions.len()))
}

/// Updates the tracked terminal size for a simulated session.
pub fn resize_session(
    sessions: &mut [SessionTab],
    session_id: &str,
    cols: u16,
    rows: u16,
) -> AppResult<String> {
    if cols == 0 || rows == 0 {
        return Err(AppError::new(
            "invalid_terminal_size",
            "终端尺寸必须大于 0",
        ));
    }

    let session = find_session_mut(sessions, session_id)?;
    session.terminal_cols = cols;
    session.terminal_rows = rows;
    session.updated_at = now_millis();

    Ok(session.title.clone())
}

/// Removes a session and returns its title for logging.
pub fn close_session(sessions: &mut Vec<SessionTab>, session_id: &str) -> AppResult<String> {
    let index = sessions
        .iter()
        .position(|session| session.id == session_id)
        .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))?;
    let session = sessions.remove(index);

    Ok(session.title)
}

fn ensure_session_exists(sessions: &[SessionTab], session_id: &str) -> AppResult<()> {
    sessions
        .iter()
        .find(|session| session.id == session_id)
        .map(|_| ())
        .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))
}

fn find_session_mut<'a>(sessions: &'a mut [SessionTab], session_id: &str) -> AppResult<&'a mut SessionTab> {
    sessions
        .iter_mut()
        .find(|session| session.id == session_id)
        .ok_or_else(|| AppError::new("session_not_found", session_id.to_string()))
}

fn next_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{}-{}", prefix, nanos)
}

fn now_millis() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[cfg(test)]
mod tests {
    use super::{
        append_session_output, append_simulated_input, clear_session_output, close_other_sessions,
        open_connected_session, open_simulated_session, reconnect_session, resize_session, set_session_status,
        DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS,
    };
    use crate::models::ConnectionProfile;

    fn connection() -> ConnectionProfile {
        ConnectionProfile {
            id: "conn-1".into(),
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
            note: String::new(),
            last_connected_at: None,
        }
    }

    #[test]
    fn open_session_uses_default_terminal_size() {
        let session = open_simulated_session(&connection());

        assert_eq!(session.terminal_cols, DEFAULT_TERMINAL_COLS);
        assert_eq!(session.terminal_rows, DEFAULT_TERMINAL_ROWS);
        assert!(session.last_output.contains("已连接到"));
    }

    #[test]
    fn send_input_appends_command_output() {
        let mut sessions = vec![open_simulated_session(&connection())];
        let session_id = sessions[0].id.clone();

        let title =
            append_simulated_input(&mut sessions, &session_id, "ls -la").expect("input should succeed");

        assert_eq!(title, "测试主机");
        assert!(sessions[0].last_output.contains("$ ls -la"));
    }

    #[test]
    fn open_connected_session_supports_custom_initial_output() {
        let session = open_connected_session(&connection(), "ready".into(), 80, 24);

        assert_eq!(session.last_output, "ready");
        assert_eq!(session.terminal_cols, 80);
        assert_eq!(session.terminal_rows, 24);
    }

    #[test]
    fn append_session_output_updates_transcript() {
        let mut sessions = vec![open_simulated_session(&connection())];
        let session_id = sessions[0].id.clone();

        append_session_output(&mut sessions, &session_id, "\r\nhello").expect("append should succeed");

        assert!(sessions[0].last_output.ends_with("\r\nhello"));
    }

    #[test]
    fn set_session_status_appends_message() {
        let mut sessions = vec![open_simulated_session(&connection())];
        let session_id = sessions[0].id.clone();

        let title = set_session_status(&mut sessions, &session_id, "disconnected", Some("连接已断开"))
            .expect("status update should succeed");

        assert_eq!(title, "测试主机");
        assert_eq!(sessions[0].status, "disconnected");
        assert!(sessions[0].last_output.contains("连接已断开"));
    }

    #[test]
    fn reconnect_session_updates_output() {
        let mut sessions = vec![open_simulated_session(&connection())];
        let session_id = sessions[0].id.clone();

        reconnect_session(&mut sessions, &session_id, &connection()).expect("reconnect should succeed");

        assert!(sessions[0].last_output.contains("已重新连接"));
    }

    #[test]
    fn clear_session_output_replaces_transcript() {
        let mut sessions = vec![open_simulated_session(&connection())];
        let session_id = sessions[0].id.clone();

        clear_session_output(&mut sessions, &session_id).expect("clear should succeed");

        assert_eq!(sessions[0].last_output, "会话输出已清空。");
    }

    #[test]
    fn close_other_sessions_keeps_only_target() {
        let mut sessions = vec![
            open_simulated_session(&connection()),
            open_simulated_session(&ConnectionProfile {
                id: "conn-2".into(),
                name: "第二主机".into(),
                ..connection()
            }),
        ];
        let keep_id = sessions[0].id.clone();

        let removed = close_other_sessions(&mut sessions, &keep_id).expect("close others should succeed");

        assert_eq!(removed, 1);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, keep_id);
    }

    #[test]
    fn close_other_sessions_requires_existing_target() {
        let mut sessions = vec![open_simulated_session(&connection())];

        let error = close_other_sessions(&mut sessions, "missing-session")
            .expect_err("close others should fail");

        assert_eq!(error.code, "session_not_found");
    }

    #[test]
    fn resize_session_tracks_terminal_dimensions() {
        let mut sessions = vec![open_simulated_session(&connection())];
        let session_id = sessions[0].id.clone();

        resize_session(&mut sessions, &session_id, 160, 48).expect("resize should succeed");

        assert_eq!(sessions[0].terminal_cols, 160);
        assert_eq!(sessions[0].terminal_rows, 48);
    }

    #[test]
    fn resize_session_rejects_zero_dimensions() {
        let mut sessions = vec![open_simulated_session(&connection())];
        let session_id = sessions[0].id.clone();

        let error = resize_session(&mut sessions, &session_id, 0, 48).expect_err("resize should fail");

        assert_eq!(error.code, "invalid_terminal_size");
    }

    #[test]
    fn reconnect_session_requires_existing_session() {
        let mut sessions = vec![open_simulated_session(&connection())];

        let error = reconnect_session(&mut sessions, "missing-session", &connection())
            .expect_err("reconnect should fail");

        assert_eq!(error.code, "session_not_found");
    }
}
