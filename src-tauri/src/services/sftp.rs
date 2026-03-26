use std::{cmp::Ordering, fs, path::Path, time::Duration};

use russh::client;
use russh_sftp::{
    client::{SftpSession, error::Error as SftpError, fs::DirEntry},
    protocol::{FileAttributes, FileType, StatusCode},
};
use tokio::io::AsyncWriteExt;

use crate::{
    error::{AppError, AppResult},
    models::RemoteFileEntry,
    services::ssh::TermoraXClientHandler,
};

const DEFAULT_SFTP_TIMEOUT_SECS: u64 = 10;

/// Result returned after listing a remote directory.
#[derive(Debug, Clone)]
pub struct ListedRemoteDirectory {
    /// Canonical absolute path returned by the remote SFTP server.
    pub canonical_path: String,
    /// Entries contained in the requested remote directory.
    pub entries: Vec<RemoteFileEntry>,
}

/// SFTP service backed by the existing russh transport.
pub struct RusshSftpService;

impl RusshSftpService {
    /// Creates the default russh-backed SFTP service.
    pub fn new() -> Self {
        Self
    }

    /// Lists entries from a remote directory over a new SFTP subsystem channel.
    pub async fn list_directory(
        &self,
        connection: &client::Handle<TermoraXClientHandler>,
        path: &str,
    ) -> AppResult<ListedRemoteDirectory> {
        let requested_path = normalize_requested_path(path);
        let sftp = self.open_session(connection).await?;

        let canonical_path = sftp
            .canonicalize(requested_path.as_str())
            .await
            .map_err(|error| classify_sftp_error("sftp_path_resolve_failed", "解析远程目录失败", error))?;

        let mut entries = sftp
            .read_dir(canonical_path.as_str())
            .await
            .map_err(|error| classify_sftp_error("sftp_list_failed", "读取远程目录失败", error))?
            .map(|entry| map_dir_entry(&canonical_path, entry))
            .collect::<Vec<_>>();

        entries.sort_by(compare_remote_entries);

        Ok(ListedRemoteDirectory {
            canonical_path,
            entries,
        })
    }

    /// Uploads a local file to the provided remote path.
    pub async fn upload_file(
        &self,
        connection: &client::Handle<TermoraXClientHandler>,
        local_path: &Path,
        remote_path: &str,
    ) -> AppResult<u64> {
        let bytes = fs::read(local_path)?;
        let sftp = self.open_session(connection).await?;
        let mut remote_file = sftp
            .create(remote_path)
            .await
            .map_err(|error| classify_sftp_error("sftp_upload_failed", "上传远程文件失败", error))?;

        remote_file
            .write_all(&bytes)
            .await
            .map_err(|error| classify_sftp_error("sftp_upload_failed", "写入远程文件失败", error.into()))?;

        Ok(bytes.len() as u64)
    }

    /// Downloads a remote file into the provided local path.
    pub async fn download_file(
        &self,
        connection: &client::Handle<TermoraXClientHandler>,
        remote_path: &str,
        local_path: &Path,
    ) -> AppResult<u64> {
        let sftp = self.open_session(connection).await?;
        let bytes = sftp
            .read(remote_path)
            .await
            .map_err(|error| classify_sftp_error("sftp_download_failed", "下载远程文件失败", error))?;

        if let Some(parent) = local_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(local_path, &bytes)?;

        Ok(bytes.len() as u64)
    }

    /// Creates a remote directory at the provided path.
    pub async fn create_directory(
        &self,
        connection: &client::Handle<TermoraXClientHandler>,
        remote_path: &str,
    ) -> AppResult<()> {
        let sftp = self.open_session(connection).await?;
        sftp.create_dir(remote_path)
            .await
            .map_err(|error| classify_sftp_error("sftp_create_dir_failed", "创建远程目录失败", error))
    }

    /// Deletes a remote file at the provided path.
    pub async fn delete_file(
        &self,
        connection: &client::Handle<TermoraXClientHandler>,
        remote_path: &str,
    ) -> AppResult<()> {
        let sftp = self.open_session(connection).await?;
        sftp.remove_file(remote_path)
            .await
            .map_err(|error| classify_sftp_error("sftp_delete_file_failed", "删除远程文件失败", error))
    }

    /// Deletes an empty remote directory at the provided path.
    pub async fn delete_directory(
        &self,
        connection: &client::Handle<TermoraXClientHandler>,
        remote_path: &str,
    ) -> AppResult<()> {
        let sftp = self.open_session(connection).await?;
        sftp.remove_dir(remote_path)
            .await
            .map_err(|error| classify_sftp_error("sftp_delete_dir_failed", "删除远程目录失败", error))
    }

    /// Renames a remote file-system entry.
    pub async fn rename_path(
        &self,
        connection: &client::Handle<TermoraXClientHandler>,
        old_path: &str,
        new_path: &str,
    ) -> AppResult<()> {
        let sftp = self.open_session(connection).await?;
        sftp.rename(old_path, new_path)
            .await
            .map_err(|error| classify_sftp_error("sftp_rename_failed", "重命名远程文件失败", error))
    }

    async fn open_session(
        &self,
        connection: &client::Handle<TermoraXClientHandler>,
    ) -> AppResult<SftpSession> {
        let timeout = Duration::from_secs(DEFAULT_SFTP_TIMEOUT_SECS);
        let channel = tokio::time::timeout(timeout, connection.channel_open_session())
            .await
            .map_err(|_| AppError::new("sftp_open_timeout", "SFTP 通道打开超时"))?
            .map_err(|error| classify_ssh_channel_error("sftp_open_failed", "SFTP 通道打开失败", error))?;

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|error| classify_ssh_channel_error("sftp_subsystem_failed", "SFTP 子系统启动失败", error))?;

        SftpSession::new_opts(channel.into_stream(), Some(DEFAULT_SFTP_TIMEOUT_SECS))
            .await
            .map_err(|error| classify_sftp_error("sftp_init_failed", "SFTP 初始化失败", error))
    }
}

/// Returns the default SFTP service used by the backend runtime.
pub fn default_sftp_service() -> RusshSftpService {
    RusshSftpService::new()
}

fn normalize_requested_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        ".".into()
    } else {
        trimmed.into()
    }
}

fn map_dir_entry(base_path: &str, entry: DirEntry) -> RemoteFileEntry {
    let name = entry.file_name();
    let metadata = entry.metadata();
    let kind = classify_remote_entry_kind(entry.file_type()).to_string();

    RemoteFileEntry {
        name: name.clone(),
        path: join_remote_path(base_path, &name),
        kind,
        size: metadata.len(),
        modified_at: metadata_modified_at(&metadata),
        created_at: String::new(),
        permissions: metadata_permissions(&metadata),
        owner: metadata_owner(&metadata),
        group: metadata_group(&metadata),
    }
}

fn classify_remote_entry_kind(file_type: FileType) -> &'static str {
    if file_type.is_dir() {
        "directory"
    } else {
        "file"
    }
}

fn join_remote_path(base_path: &str, name: &str) -> String {
    if base_path == "/" {
        return format!("/{}", name);
    }

    let trimmed_base = base_path.trim_end_matches('/');
    format!("{trimmed_base}/{name}")
}

fn metadata_modified_at(metadata: &FileAttributes) -> String {
    metadata
        .mtime
        .map(|seconds| u128::from(seconds).saturating_mul(1000).to_string())
        .unwrap_or_default()
}

fn metadata_permissions(metadata: &FileAttributes) -> String {
    metadata
        .permissions
        .map(|permissions| format!("{:o}", permissions & 0o7777))
        .unwrap_or_default()
}

fn metadata_owner(metadata: &FileAttributes) -> String {
    metadata
        .user
        .clone()
        .or_else(|| metadata.uid.map(|uid| uid.to_string()))
        .unwrap_or_default()
}

fn metadata_group(metadata: &FileAttributes) -> String {
    metadata
        .group
        .clone()
        .or_else(|| metadata.gid.map(|gid| gid.to_string()))
        .unwrap_or_default()
}

fn compare_remote_entries(left: &RemoteFileEntry, right: &RemoteFileEntry) -> Ordering {
    match (left.kind.as_str(), right.kind.as_str()) {
        ("directory", "file") => Ordering::Less,
        ("file", "directory") => Ordering::Greater,
        _ => left
            .name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.name.cmp(&right.name)),
    }
}

fn classify_ssh_channel_error(
    default_code: &'static str,
    fallback_message: &'static str,
    error: russh::Error,
) -> AppError {
    AppError::new(default_code, format!("{fallback_message}: {}", error))
}

fn classify_sftp_error(default_code: &'static str, fallback_message: &'static str, error: SftpError) -> AppError {
    let code = match &error {
        SftpError::Timeout => "sftp_timeout",
        SftpError::Status(status) => match status.status_code {
            StatusCode::NoSuchFile => "sftp_path_not_found",
            StatusCode::PermissionDenied => "sftp_permission_denied",
            StatusCode::ConnectionLost | StatusCode::NoConnection => "sftp_disconnected",
            StatusCode::OpUnsupported => "sftp_unsupported",
            _ => default_code,
        },
        SftpError::IO(message) if message.to_ascii_lowercase().contains("timed out") => "sftp_timeout",
        _ => default_code,
    };

    AppError::new(code, format!("{fallback_message}: {}", error))
}

#[cfg(test)]
mod tests {
    use super::{
        classify_remote_entry_kind, compare_remote_entries, join_remote_path, metadata_group,
        metadata_modified_at, metadata_owner, metadata_permissions, normalize_requested_path,
    };
    use crate::models::RemoteFileEntry;
    use russh_sftp::protocol::{FileAttributes, FileType};

    #[test]
    fn normalize_requested_path_falls_back_to_current_directory() {
        assert_eq!(normalize_requested_path(""), ".");
        assert_eq!(normalize_requested_path("   "), ".");
        assert_eq!(normalize_requested_path("/var/log"), "/var/log");
    }

    #[test]
    fn join_remote_path_preserves_root_directory() {
        assert_eq!(join_remote_path("/", "etc"), "/etc");
        assert_eq!(join_remote_path("/home/demo", "logs"), "/home/demo/logs");
        assert_eq!(join_remote_path("/home/demo/", "logs"), "/home/demo/logs");
    }

    #[test]
    fn classify_remote_entry_kind_maps_non_directories_to_file() {
        assert_eq!(classify_remote_entry_kind(FileType::Dir), "directory");
        assert_eq!(classify_remote_entry_kind(FileType::File), "file");
        assert_eq!(classify_remote_entry_kind(FileType::Symlink), "file");
        assert_eq!(classify_remote_entry_kind(FileType::Other), "file");
    }

    #[test]
    fn metadata_modified_at_returns_millis_string() {
        let metadata = FileAttributes {
            mtime: Some(1_711_111_111),
            ..FileAttributes::empty()
        };

        assert_eq!(metadata_modified_at(&metadata), "1711111111000");
        assert!(metadata_modified_at(&FileAttributes::empty()).is_empty());
    }

    #[test]
    fn metadata_helpers_prefer_explicit_names_and_octal_permissions() {
        let metadata = FileAttributes {
            user: Some("deploy".into()),
            group: Some("ops".into()),
            permissions: Some(0o100755),
            ..FileAttributes::empty()
        };

        assert_eq!(metadata_permissions(&metadata), "755");
        assert_eq!(metadata_owner(&metadata), "deploy");
        assert_eq!(metadata_group(&metadata), "ops");
    }

    #[test]
    fn metadata_helpers_fall_back_to_ids_when_names_are_missing() {
        let metadata = FileAttributes {
            uid: Some(1001),
            gid: Some(1002),
            ..FileAttributes::empty()
        };

        assert_eq!(metadata_owner(&metadata), "1001");
        assert_eq!(metadata_group(&metadata), "1002");
    }

    #[test]
    fn compare_remote_entries_sorts_directories_before_files_then_by_name() {
        let mut entries = vec![
            RemoteFileEntry {
                name: "z-last.txt".into(),
                path: "/tmp/z-last.txt".into(),
                kind: "file".into(),
                size: 1,
                modified_at: String::new(),
                created_at: String::new(),
                permissions: String::new(),
                owner: String::new(),
                group: String::new(),
            },
            RemoteFileEntry {
                name: "beta".into(),
                path: "/tmp/beta".into(),
                kind: "directory".into(),
                size: 0,
                modified_at: String::new(),
                created_at: String::new(),
                permissions: String::new(),
                owner: String::new(),
                group: String::new(),
            },
            RemoteFileEntry {
                name: "Alpha".into(),
                path: "/tmp/Alpha".into(),
                kind: "directory".into(),
                size: 0,
                modified_at: String::new(),
                created_at: String::new(),
                permissions: String::new(),
                owner: String::new(),
                group: String::new(),
            },
        ];

        entries.sort_by(compare_remote_entries);

        assert_eq!(entries[0].name, "Alpha");
        assert_eq!(entries[1].name, "beta");
        assert_eq!(entries[2].name, "z-last.txt");
    }
}
