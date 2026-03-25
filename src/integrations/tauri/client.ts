import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  BootstrapState,
  CommandSnippet,
  ConnectionProfile,
  RemoteFileEntry,
} from "../../entities/domain";
import { defaultAppSettings, starterConnections, starterSnippets } from "../../features/settings/model/defaults";
import { createId } from "../../shared/lib/id";
import { getLocaleState, t } from "../../shared/i18n";

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
};

function isTauriRuntime() {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";
}

function cloneState(): BootstrapState {
  return structuredClone(mockState);
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

async function callOrMock<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) {
    return invoke<T>(command, args);
  }

  switch (command) {
    case "get_bootstrap_state":
      return cloneState() as T;
    case "save_connection_profile": {
      const profile = args?.profile as ConnectionProfile;
      mockState = {
        ...mockState,
        connections: upsertById(mockState.connections, profile),
      };
      recordActivity(t("mock.savedConnection", { name: profile.name }));
      return cloneState() as T;
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
    case "open_session":
      return createMockSession(args?.connectionId as string) as T;
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
      const cwd = session?.currentPath ?? "/home/demo";
      const entries: RemoteFileEntry[] = [
        {
          name: "deploy",
          path: `${cwd}/deploy`,
          kind: "directory",
          size: 0,
          modifiedAt: new Date().toISOString(),
        },
        {
          name: "logs",
          path: `${cwd}/logs`,
          kind: "directory",
          size: 0,
          modifiedAt: new Date().toISOString(),
        },
        {
          name: "README.md",
          path: `${cwd}/README.md`,
          kind: "file",
          size: 1480,
          modifiedAt: new Date().toISOString(),
        },
      ];
      return entries as T;
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
  deleteConnectionProfile(connectionId: string) {
    return callOrMock<BootstrapState>("delete_connection_profile", { connectionId });
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
  openSession(connectionId: string) {
    return callOrMock<BootstrapState>("open_session", { connectionId });
  },
  closeSession(sessionId: string) {
    return callOrMock<BootstrapState>("close_session", { sessionId });
  },
  sendSessionInput(sessionId: string, input: string) {
    return callOrMock<BootstrapState>("send_session_input", { sessionId, input });
  },
  runSnippetOnSession(sessionId: string, snippetId: string) {
    return callOrMock<BootstrapState>("run_snippet_on_session", { sessionId, snippetId });
  },
  listRemoteEntries(sessionId: string) {
    return callOrMock<RemoteFileEntry[]>("list_remote_entries", { sessionId });
  },
};

const localeState = getLocaleState();

if (localeState.hasPendingLocaleHook) {
  recordActivity(t("locale.pendingHook", { locale: localeState.systemLocale }));
}
