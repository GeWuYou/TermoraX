import { startTransition, useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  BootstrapState,
  CommandSnippet,
  ConnectionProfile,
  RemoteFileEntry,
  RightPanelId,
  SessionTab,
} from "../entities/domain";
import { desktopClient } from "../integrations/tauri/client";
import { defaultAppSettings } from "../features/settings/model/defaults";
import { createId } from "../shared/lib/id";
import { t } from "../shared/i18n";

interface WorkspaceState extends BootstrapState {
  isLoading: boolean;
  error: string | null;
  selectedConnectionId: string | null;
  activeSessionId: string | null;
  remoteEntries: RemoteFileEntry[];
}

const initialState: WorkspaceState = {
  connections: [],
  sessions: [],
  snippets: [],
  settings: defaultAppSettings,
  extensions: [],
  activity: [],
  isLoading: true,
  error: null,
  selectedConnectionId: null,
  activeSessionId: null,
  remoteEntries: [],
};

function deriveNextSelection(snapshot: BootstrapState, currentConnectionId: string | null, currentSessionId: string | null) {
  const selectedConnectionId =
    snapshot.connections.some((item) => item.id === currentConnectionId)
      ? currentConnectionId
      : snapshot.connections[0]?.id ?? null;
  const activeSessionId =
    snapshot.sessions.some((item) => item.id === currentSessionId)
      ? currentSessionId
      : snapshot.sessions[0]?.id ?? null;

  return { selectedConnectionId, activeSessionId };
}

export function useWorkspaceApp() {
  const [state, setState] = useState<WorkspaceState>(initialState);

  function applySnapshot(snapshot: BootstrapState) {
    startTransition(() => {
      setState((current) => ({
        ...current,
        ...snapshot,
        ...deriveNextSelection(snapshot, current.selectedConnectionId, current.activeSessionId),
        isLoading: false,
        error: null,
      }));
    });
  }

  async function runMutation(task: () => Promise<BootstrapState>) {
    setState((current) => ({ ...current, error: null }));

    try {
      applySnapshot(await task());
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : t("errors.unexpectedWorkspace"),
      }));
    }
  }

  useEffect(() => {
    void runMutation(() => desktopClient.getBootstrapState());
  }, []);

  useEffect(() => {
    if (!state.activeSessionId) {
      setState((current) => ({ ...current, remoteEntries: [] }));
      return;
    }

    let cancelled = false;
    void desktopClient
      .listRemoteEntries(state.activeSessionId)
      .then((remoteEntries) => {
        if (!cancelled) {
          setState((current) => ({ ...current, remoteEntries }));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : t("errors.remoteEntries"),
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.activeSessionId]);

  const selectedConnection = useMemo(
    () => state.connections.find((item) => item.id === state.selectedConnectionId) ?? null,
    [state.connections, state.selectedConnectionId],
  );
  const activeSession = useMemo(
    () => state.sessions.find((item) => item.id === state.activeSessionId) ?? null,
    [state.sessions, state.activeSessionId],
  );

  return {
    state,
    selectedConnection,
    activeSession,
    selectConnection(connectionId: string) {
      setState((current) => ({ ...current, selectedConnectionId: connectionId }));
    },
    selectSession(sessionId: string) {
      setState((current) => ({ ...current, activeSessionId: sessionId }));
    },
    async saveConnectionProfile(input: Partial<ConnectionProfile>) {
      const profile: ConnectionProfile = {
        id: input.id ?? createId("conn"),
        name: input.name?.trim() || "未命名主机",
        host: input.host?.trim() || "127.0.0.1",
        port: input.port ?? 22,
        username: input.username?.trim() || "root",
        authType: input.authType ?? "password",
        group: input.group?.trim() || "默认分组",
        tags: input.tags ?? [],
        note: input.note?.trim() || "",
        lastConnectedAt: input.lastConnectedAt ?? null,
      };
      await runMutation(() => desktopClient.saveConnectionProfile(profile));
      setState((current) => ({ ...current, selectedConnectionId: profile.id }));
    },
    async deleteConnectionProfile(connectionId: string) {
      await runMutation(() => desktopClient.deleteConnectionProfile(connectionId));
    },
    async openSession(connectionId: string) {
      await runMutation(() => desktopClient.openSession(connectionId));
      setState((current) => ({
        ...current,
        selectedConnectionId: connectionId,
        activeSessionId:
          current.sessions.find((item) => item.connectionId === connectionId)?.id ?? current.activeSessionId,
      }));
    },
    async closeSession(sessionId: string) {
      await runMutation(() => desktopClient.closeSession(sessionId));
    },
    async sendSessionInput(sessionId: string, input: string) {
      if (!input.trim()) {
        return;
      }
      await runMutation(() => desktopClient.sendSessionInput(sessionId, input));
    },
    async saveSnippet(input: Partial<CommandSnippet>) {
      const snippet: CommandSnippet = {
        id: input.id ?? createId("snippet"),
        name: input.name?.trim() || "新片段",
        command: input.command?.trim() || "echo ready",
        description: input.description?.trim() || "",
        group: input.group?.trim() || "默认分组",
        tags: input.tags ?? [],
        favorite: input.favorite ?? false,
      };
      await runMutation(() => desktopClient.saveCommandSnippet(snippet));
    },
    async deleteSnippet(snippetId: string) {
      await runMutation(() => desktopClient.deleteCommandSnippet(snippetId));
    },
    async runSnippetOnActiveSession(snippetId: string) {
      if (!state.activeSessionId) {
        return;
      }
      await runMutation(() => desktopClient.runSnippetOnSession(state.activeSessionId as string, snippetId));
    },
    async saveSettings(settings: AppSettings) {
      await runMutation(() => desktopClient.saveSettings(settings));
    },
    async updateRightPanel(rightPanel: RightPanelId) {
      await runMutation(() =>
        desktopClient.saveSettings({
          ...state.settings,
          workspace: {
            ...state.settings.workspace,
            rightPanel,
            rightPanelVisible: true,
          },
        }),
      );
    },
    async toggleRightPanel() {
      await runMutation(() =>
        desktopClient.saveSettings({
          ...state.settings,
          workspace: {
            ...state.settings.workspace,
            rightPanelVisible: !state.settings.workspace.rightPanelVisible,
          },
        }),
      );
    },
    async toggleTheme() {
      await runMutation(() =>
        desktopClient.saveSettings({
          ...state.settings,
          terminal: {
            ...state.settings.terminal,
            theme: state.settings.terminal.theme === "midnight" ? "sand" : "midnight",
          },
        }),
      );
    },
    async resetSettings() {
      await runMutation(() => desktopClient.resetSettings());
    },
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspaceApp>;
export type WorkspaceViewState = WorkspaceState;
export type WorkspaceSession = SessionTab;
