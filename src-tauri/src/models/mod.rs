use serde::{Deserialize, Serialize};

const DEFAULT_THEME_ID: &str = "midnight";
const DEFAULT_BOTTOM_PANEL_ID: &str = "files";
const DEFAULT_SIDE_PANEL_ID: &str = "activity";

fn default_font_family() -> String {
    "\"JetBrains Mono\", \"Cascadia Code\", Consolas, monospace".into()
}

fn default_font_size() -> u16 {
    14
}

fn default_line_height() -> f32 {
    1.6
}

fn default_terminal_theme() -> String {
    DEFAULT_THEME_ID.into()
}

fn default_cursor_style() -> String {
    "block".into()
}

fn default_copy_on_select() -> bool {
    false
}

fn default_sidebar_collapsed() -> bool {
    false
}

fn default_bottom_panel() -> String {
    DEFAULT_BOTTOM_PANEL_ID.into()
}

fn default_bottom_panel_visible() -> bool {
    true
}

fn default_side_panel() -> String {
    DEFAULT_SIDE_PANEL_ID.into()
}

fn default_side_panel_visible() -> bool {
    true
}

fn normalize_theme_id(value: &str) -> &'static str {
    match value {
        "midnight" => "midnight",
        "sand" => "sand",
        "jade" => "jade",
        "tide" => "tide",
        "graphite" => "graphite",
        _ => DEFAULT_THEME_ID,
    }
}

fn normalize_bottom_panel_id(value: &str) -> &'static str {
    match value {
        "snippets" => "snippets",
        _ => DEFAULT_BOTTOM_PANEL_ID,
    }
}

fn normalize_side_panel_id(value: &str) -> &'static str {
    match value {
        "transfers" => "transfers",
        _ => DEFAULT_SIDE_PANEL_ID,
    }
}

/// A saved SSH connection profile shown in the workspace UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: String,
    pub private_key_path: String,
    pub private_key_passphrase: String,
    pub group: String,
    pub tags: Vec<String>,
    pub note: String,
    pub last_connected_at: Option<String>,
}

/// Result returned by backend-side profile validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionValidationResult {
    pub ok: bool,
    pub normalized_profile: ConnectionProfile,
    pub warnings: Vec<String>,
    pub duplicate_connection_id: Option<String>,
}

/// Result returned by the simulated P0 connection test command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub message: String,
    pub warnings: Vec<String>,
    pub duplicate_connection_id: Option<String>,
    pub normalized_profile: ConnectionProfile,
}

/// Result returned after importing connection profiles from JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionImportResult {
    pub state: BootstrapState,
    pub imported: usize,
    pub skipped: usize,
    pub duplicate_count: usize,
    pub message: String,
}

/// Result returned after exporting connection profiles into JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionExportResult {
    pub content: String,
    pub count: usize,
    pub exported_at: String,
}

/// A persisted trusted SSH host fingerprint owned by the backend state file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHost {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub trusted_at: String,
}

/// Result returned after inspecting a remote SSH host key before opening a session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostFingerprintInspection {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub trust_status: String,
    pub trusted_fingerprint: Option<String>,
    pub inspected_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    /// Stable identifier used by frontend actions to target a session.
    pub id: String,
    /// Connection profile identifier associated with this session.
    pub connection_id: String,
    /// Human-readable tab title shown in the workspace UI.
    pub title: String,
    /// Protocol label for the current session transport.
    pub protocol: String,
    /// Connection status tracked by the simulated runtime.
    pub status: String,
    /// Best-known remote working directory for file-oriented UI panels.
    pub current_path: Option<String>,
    /// Buffered terminal transcript currently exposed to the frontend.
    pub last_output: String,
    /// Tracked terminal width for simulated resize behavior.
    pub terminal_cols: u16,
    /// Tracked terminal height for simulated resize behavior.
    pub terminal_rows: u16,
    /// Session creation timestamp in backend-owned string form.
    pub created_at: String,
    /// Last mutation timestamp in backend-owned string form.
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileEntry {
    /// Display name of the remote entry.
    pub name: String,
    /// Absolute remote path of the entry.
    pub path: String,
    /// Entry kind exposed to the frontend.
    pub kind: String,
    /// Best-known byte size returned by SFTP metadata.
    pub size: u64,
    /// Last modification timestamp in milliseconds since Unix epoch.
    pub modified_at: String,
    /// Creation timestamp if the remote server exposes it.
    pub created_at: String,
    /// Unix-style permissions shown in octal form when available.
    pub permissions: String,
    /// Remote user or uid when available from the SFTP server.
    pub owner: String,
    /// Remote group or gid when available from the SFTP server.
    pub group: String,
}

/// Canonical remote directory listing returned across the Tauri boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirectoryListing {
    /// Canonical absolute path resolved by the remote SFTP server.
    pub canonical_path: String,
    /// Entries contained in the directory.
    pub entries: Vec<RemoteFileEntry>,
}

/// A tracked upload or download task shown in the transfer center.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferTask {
    pub id: String,
    pub session_id: String,
    pub direction: String,
    pub status: String,
    pub local_path: String,
    pub remote_path: String,
    pub bytes_total: u64,
    pub bytes_transferred: u64,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSnippet {
    pub id: String,
    pub name: String,
    pub command: String,
    pub description: String,
    pub group: String,
    pub tags: Vec<String>,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPreferences {
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: u16,
    #[serde(default = "default_line_height")]
    pub line_height: f32,
    #[serde(default = "default_terminal_theme")]
    pub theme: String,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default = "default_copy_on_select")]
    pub copy_on_select: bool,
}

impl Default for TerminalPreferences {
    fn default() -> Self {
        Self {
            font_family: default_font_family(),
            font_size: default_font_size(),
            line_height: default_line_height(),
            theme: default_terminal_theme(),
            cursor_style: default_cursor_style(),
            copy_on_select: default_copy_on_select(),
        }
    }
}

impl TerminalPreferences {
    pub fn normalize(mut self) -> Self {
        self.theme = normalize_theme_id(self.theme.trim()).into();
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLayout {
    #[serde(default = "default_sidebar_collapsed")]
    pub sidebar_collapsed: bool,
    #[serde(default = "default_bottom_panel", alias = "rightPanel")]
    pub bottom_panel: String,
    #[serde(default = "default_bottom_panel_visible", alias = "rightPanelVisible")]
    pub bottom_panel_visible: bool,
    #[serde(default = "default_side_panel")]
    pub side_panel: String,
    #[serde(default = "default_side_panel_visible")]
    pub side_panel_visible: bool,
}

impl Default for WorkspaceLayout {
    fn default() -> Self {
        Self {
            sidebar_collapsed: default_sidebar_collapsed(),
            bottom_panel: default_bottom_panel(),
            bottom_panel_visible: default_bottom_panel_visible(),
            side_panel: default_side_panel(),
            side_panel_visible: default_side_panel_visible(),
        }
    }
}

impl WorkspaceLayout {
    pub fn normalize(mut self) -> Self {
        self.bottom_panel = normalize_bottom_panel_id(self.bottom_panel.trim()).into();
        self.side_panel = normalize_side_panel_id(self.side_panel.trim()).into();
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub terminal: TerminalPreferences,
    #[serde(default)]
    pub workspace: WorkspaceLayout,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            terminal: TerminalPreferences::default(),
            workspace: WorkspaceLayout::default(),
        }
    }
}

impl AppSettings {
    pub fn normalize(mut self) -> Self {
        self.terminal = self.terminal.normalize();
        self.workspace = self.workspace.normalize();
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionContribution {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub description: String,
    pub entrypoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: String,
    pub title: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapState {
    pub connections: Vec<ConnectionProfile>,
    pub sessions: Vec<SessionTab>,
    pub snippets: Vec<CommandSnippet>,
    pub settings: AppSettings,
    pub extensions: Vec<ExtensionContribution>,
    pub activity: Vec<ActivityEntry>,
    pub transfers: Vec<TransferTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    pub connections: Vec<ConnectionProfile>,
    pub snippets: Vec<CommandSnippet>,
    #[serde(default)]
    pub settings: AppSettings,
    #[serde(default)]
    pub trusted_hosts: Vec<TrustedHost>,
}

impl Default for PersistedState {
    fn default() -> Self {
        Self {
            connections: vec![
                ConnectionProfile {
                    id: "conn-prod-app-01".into(),
                    name: "生产应用-01".into(),
                    host: "10.10.0.12".into(),
                    port: 22,
                    username: "deploy".into(),
                    auth_type: "privateKey".into(),
                    password: String::new(),
                    private_key_path: "~/.ssh/id_ed25519".into(),
                    private_key_passphrase: String::new(),
                    group: "生产环境".into(),
                    tags: vec!["api".into(), "cn-sha".into()],
                    note: "主应用节点".into(),
                    last_connected_at: None,
                },
                ConnectionProfile {
                    id: "conn-stage-bastion".into(),
                    name: "预发堡垒机".into(),
                    host: "10.20.1.5".into(),
                    port: 22,
                    username: "ops".into(),
                    auth_type: "password".into(),
                    password: "termorax-demo".into(),
                    private_key_path: String::new(),
                    private_key_passphrase: String::new(),
                    group: "预发环境".into(),
                    tags: vec!["bastion".into()],
                    note: "预发网络跳板机".into(),
                    last_connected_at: None,
                },
            ],
            snippets: vec![
                CommandSnippet {
                    id: "snippet-tail-api".into(),
                    name: "跟踪 API 日志".into(),
                    command: "tail -f /var/log/app/api.log".into(),
                    description: "持续查看主 API 服务日志。".into(),
                    group: "诊断".into(),
                    tags: vec!["logs".into(), "api".into()],
                    favorite: true,
                },
                CommandSnippet {
                    id: "snippet-disk-check".into(),
                    name: "磁盘占用".into(),
                    command: "df -h".into(),
                    description: "检查当前主机的磁盘占用情况。".into(),
                    group: "诊断".into(),
                    tags: vec!["disk".into()],
                    favorite: false,
                },
            ],
            settings: AppSettings::default(),
            trusted_hosts: Vec::new(),
        }
    }
}
