export type ConnectionAuthType = "password" | "privateKey";
export type SessionStatus = "idle" | "connecting" | "connected" | "disconnected";
export type ExtensionKind =
  | "sidebarPanel"
  | "terminalAction"
  | "commandPaletteItem"
  | "connectionProtocol";
export type ThemeId = "midnight" | "sand" | "jade" | "tide" | "graphite";
export type BottomPanelId = "files" | "snippets";
export type SidePanelId = "activity" | "transfers";

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: ConnectionAuthType;
  group: string;
  tags: string[];
  note: string;
  lastConnectedAt: string | null;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
}

export interface ConnectionValidationErrors {
  name?: string;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  privateKeyPath?: string;
}

export interface ConnectionDuplicateWarning {
  duplicateConnectionId: string;
  duplicateName: string;
  message: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  warnings: string[];
  duplicateConnectionId: string | null;
  normalizedProfile: ConnectionProfile;
}

export type HostTrustStatus = "trusted" | "untrusted" | "mismatch";

export interface HostFingerprintInspection {
  connectionId: string;
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  trustStatus: HostTrustStatus;
  trustedFingerprint: string | null;
  inspectedAt: string;
}

export type PendingHostVerification = HostFingerprintInspection;

export interface ConnectionExportResult {
  content: string;
  count: number;
  exportedAt: string;
}

export interface SessionTab {
  id: string;
  connectionId: string;
  title: string;
  protocol: "ssh";
  status: SessionStatus;
  currentPath: string | null;
  lastOutput: string;
  terminalCols?: number;
  terminalRows?: number;
  createdAt: string;
  updatedAt: string;
}

export type SessionOutputStream = "stdout" | "stderr";

export interface SessionOutputEvent {
  kind: "output";
  sessionId: string;
  stream: SessionOutputStream;
  chunk: string;
  occurredAt: string;
}

export interface SessionStatusEvent {
  kind: "status";
  sessionId: string;
  status?: SessionStatus;
  message: string | null;
  errorCode: string | null;
  occurredAt: string;
}

export type SessionEvent = SessionOutputEvent | SessionStatusEvent;

export interface RemoteFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: string;
  createdAt: string | null;
  permissions: string | null;
  owner: string | null;
  group: string | null;
}

export interface RemoteDirectoryListing {
  canonicalPath: string;
  entries: RemoteFileEntry[];
}

export type TransferDirection = "upload" | "download";
export type TransferStatus = "running" | "succeeded" | "failed";

export interface TransferTask {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  status: TransferStatus;
  localPath: string;
  remotePath: string;
  bytesTotal: number;
  bytesTransferred: number;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
}

export interface CommandSnippet {
  id: string;
  name: string;
  command: string;
  description: string;
  group: string;
  tags: string[];
  favorite: boolean;
}

export interface TerminalPreferences {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  theme: ThemeId;
  cursorStyle: "block" | "line";
  copyOnSelect: boolean;
}

export interface WorkspaceLayout {
  sidebarCollapsed: boolean;
  bottomPanel: BottomPanelId;
  bottomPanelVisible: boolean;
  sidePanel: SidePanelId;
  sidePanelVisible: boolean;
}

export interface AppSettings {
  terminal: TerminalPreferences;
  workspace: WorkspaceLayout;
}

export interface ExtensionContribution {
  id: string;
  title: string;
  kind: ExtensionKind;
  description: string;
  entrypoint: string;
}

export interface ActivityEntry {
  id: string;
  title: string;
  timestamp: string;
}

export interface BootstrapState {
  connections: ConnectionProfile[];
  sessions: SessionTab[];
  snippets: CommandSnippet[];
  settings: AppSettings;
  extensions: ExtensionContribution[];
  activity: ActivityEntry[];
  transfers: TransferTask[];
}

export interface ConnectionImportResult {
  state: BootstrapState;
  imported: number;
  skipped: number;
  duplicateCount: number;
  message: string;
}
