export type ConnectionAuthType = "password" | "privateKey";
export type SessionStatus = "idle" | "connecting" | "connected" | "disconnected";
export type ExtensionKind =
  | "sidebarPanel"
  | "terminalAction"
  | "commandPaletteItem"
  | "connectionProtocol";
export type RightPanelId = "files" | "snippets" | "activity";

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
}

export interface ConnectionValidationErrors {
  name?: string;
  host?: string;
  port?: string;
  username?: string;
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

export interface RemoteFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: string;
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
  theme: "midnight" | "sand";
  cursorStyle: "block" | "line";
  copyOnSelect: boolean;
}

export interface WorkspaceLayout {
  sidebarCollapsed: boolean;
  rightPanel: RightPanelId;
  rightPanelVisible: boolean;
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
}

export interface ConnectionImportResult {
  state: BootstrapState;
  imported: number;
  skipped: number;
  duplicateCount: number;
  message: string;
}
