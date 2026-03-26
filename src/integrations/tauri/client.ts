import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  BootstrapState,
  CommandSnippet,
  ConnectionExportResult,
  ConnectionImportResult,
  ConnectionProfile,
  ConnectionTestResult,
  HostFingerprintInspection,
  HostTrustStatus,
  RemoteDirectoryListing,
  RemoteFileEntry,
  SessionEvent,
  TransferTask,
} from "../../entities/domain";
import { defaultAppSettings, starterConnections, starterSnippets } from "../../features/settings/model/defaults";
import {
  findConnectionDuplicate,
  normalizeConnectionInput,
  validateConnectionProfile,
} from "../../shared/lib/connections";
import { createId } from "../../shared/lib/id";
import { getLocaleState, t } from "../../shared/i18n";
import { listenSessionEvents } from "./sessionEvents";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const starterExtensions = [
  {
    id: "builtin.sidebar.files",
    title: "远程文件",
    kind: "sidebarPanel" as const,
    description: "内建 SFTP 文件浏览面板。",
    entrypoint: "features/sftp/components/FilePanel",
  },
  {
    id: "builtin.sidebar.snippets",
    title: "命令片段",
    kind: "sidebarPanel" as const,
    description: "命令片段执行与管理面板。",
    entrypoint: "features/snippets/components/SnippetPanel",
  },
  {
    id: "builtin.sidebar.transfers",
    title: "传输任务",
    kind: "sidebarPanel" as const,
    description: "上传下载任务状态面板。",
    entrypoint: "features/transfers/components/TransferPanel",
  },
  {
    id: "builtin.protocol.ssh",
    title: "SSH 适配器",
    kind: "connectionProtocol" as const,
    description: "交互式远程会话的主协议适配器。",
    entrypoint: "services/ssh",
  },
];

let mockState: BootstrapState = {
  connections: starterConnections,
  sessions: [],
  snippets: starterSnippets,
  settings: defaultAppSettings,
  extensions: starterExtensions,
  activity: [
    {
      id: createId("activity"),
      title: t("mock.browserFallback"),
      timestamp: new Date().toISOString(),
    },
  ],
  transfers: [],
};

const mockTrustedHosts: Record<string, string> = {};

function hostKeyCacheKey(connection: ConnectionProfile): string {
  return `${connection.host}:${connection.port}`;
}

function mockFingerprintForConnection(connection: ConnectionProfile): string {
  const normalizedId = connection.id.replace(/[^a-zA-Z0-9]/g, "");
  return `SHA256:${normalizedId}-fingerprint`;
}

function buildMockInspection(connectionId: string): HostFingerprintInspection {
  const connection = mockState.connections.find((item) => item.id === connectionId);

  if (!connection) {
    throw new Error("未找到连接配置");
  }

  const fingerprint = mockFingerprintForConnection(connection);
  const trustedFingerprint = mockTrustedHosts[hostKeyCacheKey(connection)] ?? null;
  let trustStatus: HostTrustStatus = "untrusted";

  if (trustedFingerprint) {
    trustStatus = trustedFingerprint === fingerprint ? "trusted" : "mismatch";
  }

  return {
    connectionId,
    host: connection.host,
    port: connection.port,
    algorithm: "ssh-ed25519",
    fingerprint,
    trustStatus,
    trustedFingerprint,
    inspectedAt: new Date().toISOString(),
  };
}
const mockRemoteFileSystem: Record<string, RemoteFileEntry[]> = {};

function isTauriRuntime() {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";
}

function cloneState(): BootstrapState {
  return structuredClone(mockState);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readStringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

function readNumberField(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function deriveRemoteName(path: string): string {
  if (path === "/") {
    return "/";
  }

  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/**
 * Normalizes runtime payloads so the frontend stays resilient when Tauri returns
 * slightly different field names or sparse metadata from the SFTP backend.
 */
export function normalizeRemoteFileEntry(input: unknown): RemoteFileEntry {
  const record = readRecord(input) ?? {};
  const path = readStringField(record, "path", "fullPath", "remotePath") ?? "/";
  const kindValue = readStringField(record, "kind", "type") ?? "file";
  const kind = kindValue === "directory" ? "directory" : "file";

  return {
    name: readStringField(record, "name", "filename", "fileName") ?? deriveRemoteName(path),
    path,
    kind,
    size: readNumberField(record, "size", "length") ?? 0,
    modifiedAt: readStringField(record, "modifiedAt", "modified_at", "mtime") ?? "",
    createdAt: readStringField(record, "createdAt", "created_at", "ctime"),
    permissions: readStringField(record, "permissions", "mode", "permission"),
    owner: readStringField(record, "owner", "user", "uid"),
    group: readStringField(record, "group", "gid"),
  };
}

function normalizeRemoteEntries(input: unknown): RemoteFileEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((entry) => normalizeRemoteFileEntry(entry));
}

function normalizeRemoteDirectoryListing(input: unknown): RemoteDirectoryListing {
  const record = readRecord(input) ?? {};
  return {
    canonicalPath: readStringField(record, "canonicalPath", "canonical_path", "path") ?? "/",
    entries: normalizeRemoteEntries(record.entries),
  };
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T): T[] {
  const index = items.findIndex((item) => item.id === nextItem.id);

  if (index === -1) {
    return [nextItem, ...items];
  }

  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
}

function recordActivity(title: string) {
  mockState = {
    ...mockState,
    activity: [
      {
        id: createId("activity"),
        title,
        timestamp: new Date().toISOString(),
      },
      ...mockState.activity,
    ].slice(0, 20),
  };
}

function mockRemoteEntriesForPath(path: string): RemoteFileEntry[] {
  if (mockRemoteFileSystem[path]) {
    return structuredClone(mockRemoteFileSystem[path]);
  }

  const now = new Date().toISOString();

  type MockEntryInput = Pick<RemoteFileEntry, "name" | "path" | "kind" | "size" | "modifiedAt"> &
    Partial<Pick<RemoteFileEntry, "createdAt" | "permissions" | "owner" | "group">>;

  const withMetadata = (entry: MockEntryInput): RemoteFileEntry => ({
    ...entry,
    createdAt: entry.createdAt ?? now,
    permissions: entry.permissions ?? "755",
    owner: entry.owner ?? "demo",
    group: entry.group ?? "staff",
  });

  if (path === "/") {
    const entries = [
      withMetadata({ name: "home", path: "/home", kind: "directory", size: 0, modifiedAt: now, owner: "root", group: "root" }),
      withMetadata({ name: "var", path: "/var", kind: "directory", size: 0, modifiedAt: now, owner: "root", group: "root" }),
      withMetadata({ name: "etc", path: "/etc", kind: "directory", size: 0, modifiedAt: now, owner: "root", group: "root" }),
    ];
    mockRemoteFileSystem[path] = entries;
    return structuredClone(entries);
  }

  if (path === "/home") {
    const entries = [
      withMetadata({ name: "demo", path: "/home/demo", kind: "directory", size: 0, modifiedAt: now, owner: "demo", group: "demo" }),
      withMetadata({ name: "ops", path: "/home/ops", kind: "directory", size: 0, modifiedAt: now, owner: "ops", group: "ops" }),
    ];
    mockRemoteFileSystem[path] = entries;
    return structuredClone(entries);
  }

  const entries: RemoteFileEntry[] = [
    withMetadata({ name: "deploy", path: `${path}/deploy`, kind: "directory", size: 0, modifiedAt: now, owner: "deploy", group: "ops" }),
    withMetadata({ name: "logs", path: `${path}/logs`, kind: "directory", size: 0, modifiedAt: now, owner: "deploy", group: "ops" }),
    withMetadata({
      name: "README.md",
      path: `${path}/README.md`,
      kind: "file",
      size: 1480,
      modifiedAt: now,
      owner: "deploy",
      group: "ops",
      permissions: "644",
    }),
  ];
  mockRemoteFileSystem[path] = entries;
  return structuredClone(entries);
}

function parentRemotePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const normalized = trimmed.replace(/\/+$/, "");
  const lastSlashIndex = normalized.lastIndexOf("/");

  if (lastSlashIndex <= 0) {
    return "/";
  }

  return normalized.slice(0, lastSlashIndex);
}

function createMockSession(connectionId: string): BootstrapState {
  const connection = mockState.connections.find((item) => item.id === connectionId);

  if (!connection) {
    throw new Error("Connection not found");
  }

  const now = new Date().toISOString();
  const session = {
    id: createId("session"),
    connectionId,
    title: connection.name,
    protocol: "ssh" as const,
    status: "connected" as const,
    currentPath: `/home/${connection.username}`,
    terminalCols: 120,
    terminalRows: 32,
    lastOutput: [
      t("mock.simConnected", {
        user: connection.username,
        host: connection.host,
        port: connection.port,
      }),
      "",
      t("mock.simTransport"),
      t("mock.simShell"),
    ].join("\n"),
    createdAt: now,
    updatedAt: now,
  };

  mockState = {
    ...mockState,
    connections: mockState.connections.map((item) =>
      item.id === connectionId ? { ...item, lastConnectedAt: now } : item,
    ),
    sessions: [session, ...mockState.sessions],
  };
  recordActivity(t("mock.openedSession", { name: connection.name }));
  return cloneState();
}

function buildTestResult(profile: ConnectionProfile): ConnectionTestResult {
  const normalizedProfile = normalizeConnectionInput(profile);
  const duplicate = findConnectionDuplicate(mockState.connections, normalizedProfile);
  const validationErrors = validateConnectionProfile(normalizedProfile);

  if (Object.values(validationErrors).some(Boolean)) {
    throw new Error(Object.values(validationErrors).filter(Boolean).join(" "));
  }

  return {
    ok: true,
    message: duplicate ? t("connections.testDuplicate") : t("connections.testSuccess"),
    warnings: duplicate ? [duplicate.message] : [],
    duplicateConnectionId: duplicate?.duplicateConnectionId ?? null,
    normalizedProfile,
  };
}

function sanitizeImportedProfiles(content: string) {
  if (!content.trim()) {
    throw new Error(t("errors.connectionImportEmpty"));
  }

  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(t("connections.importInvalid"));
  }

  return parsed
    .map((item) => normalizeConnectionInput(item as ConnectionProfile))
    .filter((item) => item.name || item.host || item.username);
}

function createTransferTask(
  direction: "upload" | "download",
  localPath: string,
  remotePath: string,
  bytesTotal: number,
  bytesTransferred: number,
): TransferTask {
  const now = new Date().toISOString();

  return {
    id: createId("transfer"),
    sessionId: mockState.sessions[0]?.id ?? "",
    direction,
    status: "succeeded",
    localPath,
    remotePath,
    bytesTotal,
    bytesTransferred,
    startedAt: now,
    finishedAt: now,
    message: null,
  };
}

function upsertMockRemoteFile(directory: string, nextEntry: RemoteFileEntry) {
  const entries = mockRemoteEntriesForPath(directory).filter((entry) => entry.path !== nextEntry.path);
  mockRemoteFileSystem[directory] = [nextEntry, ...entries];
}

function remotePathBaseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function findMockRemoteEntry(path: string): RemoteFileEntry | null {
  const directory = parentRemotePath(path);
  return mockRemoteEntriesForPath(directory).find((entry) => entry.path === path) ?? null;
}

function removeMockRemoteEntry(path: string, isDirectory: boolean) {
  const directory = parentRemotePath(path);
  mockRemoteFileSystem[directory] = mockRemoteEntriesForPath(directory).filter((entry) => entry.path !== path);

  if (!isDirectory) {
    return;
  }

  for (const key of Object.keys(mockRemoteFileSystem)) {
    if (key === path || key.startsWith(`${path}/`)) {
      delete mockRemoteFileSystem[key];
      continue;
    }

    mockRemoteFileSystem[key] = mockRemoteFileSystem[key].filter(
      (entry) => entry.path !== path && !entry.path.startsWith(`${path}/`),
    );
  }
}

function renameMockRemoteEntry(path: string, targetPath: string, isDirectory: boolean) {
  const existingEntry =
    findMockRemoteEntry(path) ??
    ({
      name: remotePathBaseName(path),
      path,
      kind: isDirectory ? "directory" : "file",
      size: 0,
      modifiedAt: new Date().toISOString(),
      createdAt: null,
      permissions: isDirectory ? "755" : "644",
      owner: "deploy",
      group: "ops",
    } satisfies RemoteFileEntry);

  removeMockRemoteEntry(path, isDirectory);

  const now = new Date().toISOString();
  upsertMockRemoteFile(parentRemotePath(targetPath), {
    ...existingEntry,
    name: remotePathBaseName(targetPath),
    path: targetPath,
    modifiedAt: now,
  });

  if (!isDirectory) {
    return;
  }

  const nextFileSystem: Record<string, RemoteFileEntry[]> = {};
  for (const [directory, entries] of Object.entries(mockRemoteFileSystem)) {
    const nextDirectory =
      directory === path ? targetPath : directory.startsWith(`${path}/`) ? directory.replace(path, targetPath) : directory;
    nextFileSystem[nextDirectory] = entries.map((entry) => ({
      ...entry,
      path: entry.path === path ? targetPath : entry.path.startsWith(`${path}/`) ? entry.path.replace(path, targetPath) : entry.path,
    }));
  }

  Object.assign(mockRemoteFileSystem, nextFileSystem);
}

async function callOrMock<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) {
    return invoke<T>(command, args);
  }

  switch (command) {
    case "get_bootstrap_state":
      return cloneState() as T;
    case "save_connection_profile": {
      const profile = normalizeConnectionInput(args?.profile as ConnectionProfile);
      const validationErrors = validateConnectionProfile(profile);

      if (Object.values(validationErrors).some(Boolean)) {
        throw new Error(Object.values(validationErrors).filter(Boolean).join(" "));
      }

      mockState = {
        ...mockState,
        connections: upsertById(mockState.connections, profile),
      };
      recordActivity(t("mock.savedConnection", { name: profile.name }));
      return cloneState() as T;
    }
    case "test_connection_profile": {
      const profile = args?.profile as ConnectionProfile;
      const result = buildTestResult(profile);
      recordActivity(t("mock.testedConnection", { name: result.normalizedProfile.name }));
      return result as T;
    }
    case "delete_connection_profile": {
      const connectionId = args?.connectionId as string;
      const connection = mockState.connections.find((item) => item.id === connectionId);
      mockState = {
        ...mockState,
        connections: mockState.connections.filter((item) => item.id !== connectionId),
        sessions: mockState.sessions.filter((item) => item.connectionId !== connectionId),
      };
      recordActivity(t("mock.deletedConnection", { name: connection?.name ?? connectionId }));
      return cloneState() as T;
    }
    case "import_connection_profiles_json": {
      const content = String(args?.payload ?? args?.content ?? "");
      const importedProfiles = sanitizeImportedProfiles(content);
      let imported = 0;
      let skipped = 0;
      let duplicateCount = 0;

      for (const profile of importedProfiles) {
        const validationErrors = validateConnectionProfile(profile);
        const duplicate = findConnectionDuplicate(mockState.connections, profile);

        if (Object.values(validationErrors).some(Boolean)) {
          skipped += 1;
          continue;
        }

        if (duplicate) {
          duplicateCount += 1;
          skipped += 1;
          continue;
        }

        imported += 1;
        mockState = {
          ...mockState,
          connections: upsertById(mockState.connections, {
            ...profile,
            id: profile.id || createId("conn"),
          }),
        };
      }

      recordActivity(t("mock.importedConnections", { count: imported }));

      const result: ConnectionImportResult = {
        state: cloneState(),
        imported,
        skipped,
        duplicateCount,
        message: t("connections.importSuccess", { count: imported, skipped }),
      };

      return result as T;
    }
    case "export_connection_profiles_json": {
      const result: ConnectionExportResult = {
        content: JSON.stringify(mockState.connections, null, 2),
        count: mockState.connections.length,
        exportedAt: new Date().toISOString(),
      };
      recordActivity(t("mock.exportedConnections", { count: result.count }));
      return result as T;
    }
    case "save_command_snippet": {
      const snippet = args?.snippet as CommandSnippet;
      mockState = {
        ...mockState,
        snippets: upsertById(mockState.snippets, snippet),
      };
      recordActivity(t("mock.savedSnippet", { name: snippet.name }));
      return cloneState() as T;
    }
    case "delete_command_snippet": {
      const snippetId = args?.snippetId as string;
      const snippet = mockState.snippets.find((item) => item.id === snippetId);
      mockState = {
        ...mockState,
        snippets: mockState.snippets.filter((item) => item.id !== snippetId),
      };
      recordActivity(t("mock.deletedSnippet", { name: snippet?.name ?? snippetId }));
      return cloneState() as T;
    }
    case "save_settings": {
      const settings = args?.settings as AppSettings;
      mockState = { ...mockState, settings };
      recordActivity(t("mock.savedSettings"));
      return cloneState() as T;
    }
    case "reset_settings":
      mockState = { ...mockState, settings: defaultAppSettings };
      recordActivity(t("mock.resetSettings"));
      return cloneState() as T;
    case "inspect_connection_host": {
      const connectionId = String(args?.connectionId ?? "");
      return buildMockInspection(connectionId) as T;
    }
    case "trust_connection_host": {
      const connectionId = String(args?.connectionId ?? "");
      const fingerprint = String(args?.fingerprint ?? "");
      const inspection = buildMockInspection(connectionId);

      if (inspection.fingerprint !== fingerprint) {
        throw new Error("主机指纹已变化，请重新确认。");
      }

      const connection = mockState.connections.find((item) => item.id === connectionId);
      if (!connection) {
        throw new Error("未找到连接配置");
      }

      mockTrustedHosts[hostKeyCacheKey(connection)] = fingerprint;

      return {
        ...inspection,
        trustStatus: "trusted",
        trustedFingerprint: fingerprint,
      } as T;
    }
    case "open_session":
      return createMockSession(args?.connectionId as string) as T;
    case "reconnect_session": {
      const sessionId = args?.sessionId as string;
      mockState = {
        ...mockState,
        sessions: mockState.sessions.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                status: "connected",
                updatedAt: new Date().toISOString(),
                lastOutput: `${item.lastOutput}\n\n${t("terminal.reconnected")}`,
              }
            : item,
        ),
      };
      recordActivity(t("terminal.reconnected"));
      return cloneState() as T;
    }
    case "close_session": {
      const sessionId = args?.sessionId as string;
      const session = mockState.sessions.find((item) => item.id === sessionId);
      mockState = {
        ...mockState,
        sessions: mockState.sessions.filter((item) => item.id !== sessionId),
      };
      recordActivity(t("mock.closedSession", { name: session?.title ?? sessionId }));
      return cloneState() as T;
    }
    case "close_other_sessions": {
      const sessionId = args?.sessionId as string;
      mockState = {
        ...mockState,
        sessions: mockState.sessions.filter((item) => item.id === sessionId),
      };
      recordActivity(t("terminal.closedOthers"));
      return cloneState() as T;
    }
    case "clear_session_output": {
      const sessionId = args?.sessionId as string;
      mockState = {
        ...mockState,
        sessions: mockState.sessions.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                updatedAt: new Date().toISOString(),
                lastOutput: t("terminal.outputCleared"),
              }
            : item,
        ),
      };
      recordActivity(t("terminal.outputCleared"));
      return cloneState() as T;
    }
    case "resize_session": {
      const sessionId = args?.sessionId as string;
      const cols = Number(args?.cols ?? 120);
      const rows = Number(args?.rows ?? 32);
      mockState = {
        ...mockState,
        sessions: mockState.sessions.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                terminalCols: cols,
                terminalRows: rows,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      };
      return cloneState() as T;
    }
    case "send_session_input": {
      const sessionId = args?.sessionId as string;
      const input = (args?.input as string).trim();
      mockState = {
        ...mockState,
        sessions: mockState.sessions.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                updatedAt: new Date().toISOString(),
                lastOutput: `${item.lastOutput}\n\n$ ${input}\n${t("mock.commandAccepted")}`,
              }
            : item,
        ),
      };
      recordActivity(t("mock.sentCommand"));
      return cloneState() as T;
    }
    case "run_snippet_on_session": {
      const sessionId = args?.sessionId as string;
      const snippetId = args?.snippetId as string;
      const snippet = mockState.snippets.find((item) => item.id === snippetId);
      if (!snippet) {
        throw new Error(t("errors.snippetNotFound"));
      }
      return callOrMock<T>("send_session_input", { sessionId, input: snippet.command });
    }
    case "list_remote_entries": {
      const sessionId = args?.sessionId as string;
      const session = mockState.sessions.find((item) => item.id === sessionId);
      return mockRemoteEntriesForPath(session?.currentPath ?? "/home/demo") as T;
    }
    case "list_remote_entries_at_path": {
      const path = String(args?.path ?? "").trim() || "/";
      return {
        canonicalPath: path,
        entries: mockRemoteEntriesForPath(path),
      } as T;
    }
    case "navigate_remote_directory": {
      const sessionId = args?.sessionId as string;
      const path = String(args?.path ?? "").trim();
      if (!path) {
        throw new Error(t("errors.remoteEntries"));
      }
      mockState = {
        ...mockState,
        sessions: mockState.sessions.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                currentPath: path,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      };
      recordActivity(`已切换远程目录到 ${path}`);
      return cloneState() as T;
    }
    case "navigate_remote_to_parent": {
      const sessionId = args?.sessionId as string;
      const session = mockState.sessions.find((item) => item.id === sessionId);
      const nextPath = parentRemotePath(session?.currentPath ?? "/");
      return callOrMock<T>("navigate_remote_directory", { sessionId, path: nextPath });
    }
    case "upload_file_to_remote": {
      const localPath = String(args?.localPath ?? "");
      const remotePath = String(args?.remotePath ?? "");
      const directory = parentRemotePath(remotePath);
      const parts = remotePath.split("/").filter(Boolean);
      const filename = parts[parts.length - 1] ?? remotePath;
      const now = new Date().toISOString();
      upsertMockRemoteFile(directory, {
        name: filename,
        path: remotePath,
        kind: "file",
        size: 2048,
        modifiedAt: now,
        createdAt: null,
        permissions: "644",
        owner: "deploy",
        group: "ops",
      });
      mockState = {
        ...mockState,
        transfers: [
          createTransferTask("upload", localPath, remotePath, 2048, 2048),
          ...mockState.transfers,
        ].slice(0, 50),
      };
      recordActivity(`已上传文件到 ${remotePath}`);
      return cloneState() as T;
    }
    case "download_file_from_remote": {
      const remotePath = String(args?.remotePath ?? "");
      const localPath = String(args?.localPath ?? "");
      mockState = {
        ...mockState,
        transfers: [
          createTransferTask("download", localPath, remotePath, 2048, 2048),
          ...mockState.transfers,
        ].slice(0, 50),
      };
      recordActivity(`已下载文件到 ${localPath}`);
      return cloneState() as T;
    }
    case "create_remote_directory": {
      const path = String(args?.path ?? "");
      const now = new Date().toISOString();
      upsertMockRemoteFile(parentRemotePath(path), {
        name: remotePathBaseName(path),
        path,
        kind: "directory",
        size: 0,
        modifiedAt: now,
        createdAt: null,
        permissions: "755",
        owner: "deploy",
        group: "ops",
      });
      mockRemoteFileSystem[path] = mockRemoteFileSystem[path] ?? [];
      recordActivity(`已创建远程目录 ${path}`);
      return cloneState() as T;
    }
    case "rename_remote_entry": {
      const path = String(args?.path ?? "");
      const targetPath = String(args?.targetPath ?? "");
      const entry = findMockRemoteEntry(path);
      renameMockRemoteEntry(path, targetPath, entry?.kind === "directory");
      recordActivity(`已重命名远程路径 ${path} -> ${targetPath}`);
      return cloneState() as T;
    }
    case "delete_remote_entry": {
      const path = String(args?.path ?? "");
      const isDirectory = Boolean(args?.isDirectory);
      removeMockRemoteEntry(path, isDirectory);
      recordActivity(`已删除远程路径 ${path}`);
      return cloneState() as T;
    }
    case "retry_transfer_task": {
      const taskId = String(args?.taskId ?? "");
      const task = mockState.transfers.find((item) => item.id === taskId);
      if (!task) {
        throw new Error("未找到传输任务");
      }
      if (task.status !== "failed") {
        throw new Error("只有失败的传输任务才支持重试");
      }
      mockState = {
        ...mockState,
        transfers: mockState.transfers.map((item) =>
          item.id === taskId
            ? ({
                ...item,
                status: "running",
                bytesTransferred: 0,
                message: null,
                startedAt: new Date().toISOString(),
                finishedAt: null,
              } satisfies TransferTask)
            : item,
        ),
      };
      recordActivity(`已重试传输任务 ${taskId}`);
      return cloneState() as T;
    }
    case "clear_completed_transfer_tasks": {
      const taskCount = mockState.transfers.length;
      mockState = {
        ...mockState,
        transfers: mockState.transfers.filter((task) => task.status === "running"),
      };
      const cleared = taskCount - mockState.transfers.length;
      recordActivity(`已清理 ${cleared} 个完成任务`);
      return cloneState() as T;
    }
    default:
      throw new Error(`Unsupported mock command: ${command}`);
  }
}

export const desktopClient = {
  getBootstrapState() {
    return callOrMock<BootstrapState>("get_bootstrap_state");
  },
  saveConnectionProfile(profile: ConnectionProfile) {
    return callOrMock<BootstrapState>("save_connection_profile", { profile });
  },
  testConnectionProfile(profile: ConnectionProfile) {
    return callOrMock<ConnectionTestResult>("test_connection_profile", { profile });
  },
  deleteConnectionProfile(connectionId: string) {
    return callOrMock<BootstrapState>("delete_connection_profile", { connectionId });
  },
  importConnectionProfilesFromJson(content: string) {
    return callOrMock<ConnectionImportResult>("import_connection_profiles_json", { payload: content });
  },
  exportConnectionProfiles() {
    return callOrMock<ConnectionExportResult>("export_connection_profiles_json");
  },
  saveCommandSnippet(snippet: CommandSnippet) {
    return callOrMock<BootstrapState>("save_command_snippet", { snippet });
  },
  deleteCommandSnippet(snippetId: string) {
    return callOrMock<BootstrapState>("delete_command_snippet", { snippetId });
  },
  saveSettings(settings: AppSettings) {
    return callOrMock<BootstrapState>("save_settings", { settings });
  },
  resetSettings() {
    return callOrMock<BootstrapState>("reset_settings");
  },
  inspectConnectionHost(connectionId: string) {
    return callOrMock<HostFingerprintInspection>("inspect_connection_host", { connectionId });
  },
  trustConnectionHost(connectionId: string, fingerprint: string) {
    return callOrMock<HostFingerprintInspection>("trust_connection_host", { connectionId, fingerprint });
  },
  openSession(connectionId: string) {
    return callOrMock<BootstrapState>("open_session", { connectionId });
  },
  reconnectSession(sessionId: string) {
    return callOrMock<BootstrapState>("reconnect_session", { sessionId });
  },
  closeSession(sessionId: string) {
    return callOrMock<BootstrapState>("close_session", { sessionId });
  },
  closeOtherSessions(sessionId: string) {
    return callOrMock<BootstrapState>("close_other_sessions", { sessionId });
  },
  clearSessionOutput(sessionId: string) {
    return callOrMock<BootstrapState>("clear_session_output", { sessionId });
  },
  resizeSession(sessionId: string, cols: number, rows: number) {
    return callOrMock<BootstrapState>("resize_session", { sessionId, cols, rows });
  },
  sendSessionInput(sessionId: string, input: string) {
    return callOrMock<BootstrapState>("send_session_input", { sessionId, input });
  },
  runSnippetOnSession(sessionId: string, snippetId: string) {
    return callOrMock<BootstrapState>("run_snippet_on_session", { sessionId, snippetId });
  },
  async listRemoteEntries(sessionId: string) {
    const result = await callOrMock<unknown>("list_remote_entries", { sessionId });
    return normalizeRemoteEntries(result);
  },
  async listRemoteEntriesAtPath(sessionId: string, path: string) {
    const result = await callOrMock<unknown>("list_remote_entries_at_path", { sessionId, path });
    return normalizeRemoteDirectoryListing(result);
  },
  navigateRemoteDirectory(sessionId: string, path: string) {
    return callOrMock<BootstrapState>("navigate_remote_directory", { sessionId, path });
  },
  navigateRemoteToParent(sessionId: string) {
    return callOrMock<BootstrapState>("navigate_remote_to_parent", { sessionId });
  },
  uploadFileToRemote(sessionId: string, localPath: string, remotePath: string) {
    return callOrMock<BootstrapState>("upload_file_to_remote", { sessionId, localPath, remotePath });
  },
  downloadFileFromRemote(sessionId: string, remotePath: string, localPath: string) {
    return callOrMock<BootstrapState>("download_file_from_remote", { sessionId, remotePath, localPath });
  },
  createRemoteDirectory(sessionId: string, path: string) {
    return callOrMock<BootstrapState>("create_remote_directory", { sessionId, path });
  },
  renameRemoteEntry(sessionId: string, path: string, targetPath: string) {
    return callOrMock<BootstrapState>("rename_remote_entry", { sessionId, path, targetPath });
  },
  deleteRemoteEntry(sessionId: string, path: string, isDirectory: boolean) {
    return callOrMock<BootstrapState>("delete_remote_entry", { sessionId, path, isDirectory });
  },
  retryTransferTask(taskId: string) {
    return callOrMock<BootstrapState>("retry_transfer_task", { taskId });
  },
  clearCompletedTransferTasks() {
    return callOrMock<BootstrapState>("clear_completed_transfer_tasks");
  },
  subscribeSessionEvents(listener: (event: SessionEvent) => void) {
    if (!isTauriRuntime()) {
      return Promise.resolve(() => {});
    }
    return listenSessionEvents(listener);
  },
};

const localeState = getLocaleState();

if (localeState.hasPendingLocaleHook) {
  recordActivity(t("locale.pendingHook", { locale: localeState.systemLocale }));
}
