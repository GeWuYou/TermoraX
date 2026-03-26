import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  BottomPanelId,
  BootstrapState,
  CommandSnippet,
  ConnectionDuplicateWarning,
  ConnectionExportResult,
  ConnectionImportResult,
  ConnectionProfile,
  ConnectionTestResult,
  ConnectionValidationErrors,
  HostFingerprintInspection,
  PendingHostVerification,
  RemoteFileEntry,
  SessionEvent,
  SessionTab,
  SidePanelId,
  ThemeId,
  TransferTask,
} from "../entities/domain";
import { desktopClient } from "../integrations/tauri/client";
import { defaultAppSettings } from "../features/settings/model/defaults";
import { normalizeAppSettings } from "../features/settings/model/themes";
import {
  findConnectionDuplicate,
  hasValidationErrors,
  normalizeConnectionInput,
  validateConnectionProfile,
} from "../shared/lib/connections";
import { createId } from "../shared/lib/id";
import { t } from "../shared/i18n";
import { mergeSessionEvent } from "./sessionEvents";

interface WorkspaceState extends BootstrapState {
  isLoading: boolean;
  error: string | null;
  selectedConnectionId: string | null;
  activeSessionId: string | null;
  remoteEntries: RemoteFileEntry[];
  remoteRootEntries: RemoteFileEntry[];
  remoteEntriesLoading: boolean;
  connectionValidationErrors: ConnectionValidationErrors;
  connectionDuplicateWarning: ConnectionDuplicateWarning | null;
  connectionTestResult: ConnectionTestResult | null;
  connectionStatusMessage: string | null;
  pendingHostVerification: PendingHostVerification | null;
  lastHostInspection: HostFingerprintInspection | null;
}

const initialState: WorkspaceState = {
  connections: [],
  sessions: [],
  snippets: [],
  settings: defaultAppSettings,
  extensions: [],
  activity: [],
  transfers: [],
  isLoading: true,
  error: null,
  selectedConnectionId: null,
  activeSessionId: null,
  remoteEntries: [],
  remoteRootEntries: [],
  remoteEntriesLoading: false,
  connectionValidationErrors: {},
  connectionDuplicateWarning: null,
  connectionTestResult: null,
  connectionStatusMessage: null,
  pendingHostVerification: null,
  lastHostInspection: null,
};

const SESSION_EVENT_FLUSH_DELAY_MS = 33;
const REMOTE_PANEL_IDLE_REFRESH_DELAY_MS = 1200;
const MAX_SESSION_OUTPUT_CHARS = 200_000;

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

function normalizeBootstrapState(snapshot: BootstrapState): BootstrapState {
  return {
    ...snapshot,
    sessions: snapshot.sessions.map((session) => ({
      ...session,
      lastOutput:
        session.lastOutput.length > MAX_SESSION_OUTPUT_CHARS
          ? session.lastOutput.slice(-MAX_SESSION_OUTPUT_CHARS)
          : session.lastOutput,
    })),
    settings: normalizeAppSettings(snapshot.settings),
  };
}

function parseSessionTimestamp(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildHostInspectionMessage(inspection: HostFingerprintInspection): string {
  switch (inspection.trustStatus) {
    case "trusted":
      return t("connections.hostTrusted", { host: inspection.host, port: inspection.port });
    case "mismatch":
      return t("connections.hostInspectionMismatch", { host: inspection.host, port: inspection.port });
    default:
      return t("connections.hostInspectionPending", { host: inspection.host, port: inspection.port });
  }
}

/**
 * Preserves newer real-time terminal output when a mutation snapshot arrives behind session events.
 */
export function mergeSnapshotSessions(currentSessions: SessionTab[], snapshotSessions: SessionTab[]): SessionTab[] {
  const currentById = new Map(currentSessions.map((session) => [session.id, session]));

  return snapshotSessions.map((snapshotSession) => {
    const currentSession = currentById.get(snapshotSession.id);
    if (!currentSession || currentSession.lastOutput === snapshotSession.lastOutput) {
      return snapshotSession;
    }

    const currentExtendsSnapshot =
      currentSession.lastOutput.length > snapshotSession.lastOutput.length &&
      currentSession.lastOutput.startsWith(snapshotSession.lastOutput);
    const currentIsNewer =
      parseSessionTimestamp(currentSession.updatedAt) > parseSessionTimestamp(snapshotSession.updatedAt);
    const snapshotChangedLifecycle =
      currentSession.status !== snapshotSession.status || currentSession.currentPath !== snapshotSession.currentPath;

    if (snapshotChangedLifecycle || (!currentExtendsSnapshot && !currentIsNewer)) {
      return snapshotSession;
    }

    return {
      ...snapshotSession,
      lastOutput: currentSession.lastOutput,
      updatedAt: currentIsNewer ? currentSession.updatedAt : snapshotSession.updatedAt,
    };
  });
}

/**
 * Keeps terminal dimensions in sync locally so frequent resize acknowledgements
 * do not need to round-trip a full workspace snapshot back into React state.
 */
export function updateSessionTerminalSize(
  sessions: SessionTab[],
  sessionId: string,
  cols: number,
  rows: number,
): SessionTab[] {
  let mutated = false;

  const updated = sessions.map((session) => {
    if (session.id !== sessionId) {
      return session;
    }

    if (session.terminalCols === cols && session.terminalRows === rows) {
      return session;
    }

    mutated = true;
    return {
      ...session,
      terminalCols: cols,
      terminalRows: rows,
    };
  });

  return mutated ? updated : sessions;
}

export function useWorkspaceApp() {
  const [state, setState] = useState<WorkspaceState>(initialState);
  const remoteEntriesRequestRef = useRef(0);
  const remoteRootEntriesRequestRef = useRef(0);
  const pendingSessionEventsRef = useRef<SessionEvent[]>([]);
  const sessionEventFlushTimerRef = useRef<number | null>(null);
  const lastLoadedRemotePathRef = useRef<string | null>(null);
  const lastLoadedRootSessionRef = useRef<string | null>(null);
  const activeSessionRecord = state.sessions.find((item) => item.id === state.activeSessionId) ?? null;
  const activeSessionCurrentPath = activeSessionRecord?.currentPath ?? null;
  const activeSessionUpdatedAt = activeSessionRecord?.updatedAt ?? null;
  const activeSessionStatus = activeSessionRecord?.status ?? null;
  const filesPanelVisible =
    state.settings.workspace.bottomPanelVisible && state.settings.workspace.bottomPanel === "files";

  const refreshRemoteEntries = useCallback(async (sessionId: string) => {
    const requestId = remoteEntriesRequestRef.current + 1;
    remoteEntriesRequestRef.current = requestId;
    setState((current) => ({ ...current, remoteEntriesLoading: true }));
    try {
      const remoteEntries = await desktopClient.listRemoteEntries(sessionId);
      setState((current) => {
        if (requestId !== remoteEntriesRequestRef.current || current.activeSessionId !== sessionId) {
          return current;
        }

        return { ...current, remoteEntries, remoteEntriesLoading: false };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : t("errors.remoteEntries"),
        remoteEntriesLoading: false,
      }));
    }
  }, []);

  const refreshRemoteRootEntries = useCallback(async (sessionId: string) => {
    const requestId = remoteRootEntriesRequestRef.current + 1;
    remoteRootEntriesRequestRef.current = requestId;

    try {
      const listing = await desktopClient.listRemoteEntriesAtPath(sessionId, "/");
      const remoteRootEntries = listing.entries.filter((entry) => entry.kind === "directory");
      setState((current) => {
        if (requestId !== remoteRootEntriesRequestRef.current || current.activeSessionId !== sessionId) {
          return current;
        }

        return { ...current, remoteRootEntries };
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : t("errors.remoteEntries"),
      }));
    }
  }, []);

  function setConnectionFeedback(input: {
    errors?: ConnectionValidationErrors;
    duplicateWarning?: ConnectionDuplicateWarning | null;
    testResult?: ConnectionTestResult | null;
    statusMessage?: string | null;
  }) {
    setState((current) => ({
      ...current,
      connectionValidationErrors: input.errors ?? current.connectionValidationErrors,
      connectionDuplicateWarning:
        input.duplicateWarning === undefined ? current.connectionDuplicateWarning : input.duplicateWarning,
      connectionTestResult: input.testResult === undefined ? current.connectionTestResult : input.testResult,
      connectionStatusMessage: input.statusMessage === undefined ? current.connectionStatusMessage : input.statusMessage,
    }));
  }

  function clearConnectionFeedback() {
    setState((current) => ({
      ...current,
      connectionValidationErrors: {},
      connectionDuplicateWarning: null,
      connectionTestResult: null,
      connectionStatusMessage: null,
      pendingHostVerification: null,
    }));
  }

  function prepareConnectionProfile(input: Partial<ConnectionProfile>) {
    // Frontend validation mirrors backend rules so the form can fail fast
    // before invoking Tauri, while the backend still remains authoritative.
    const normalized = normalizeConnectionInput({
      ...input,
      id: input.id ?? createId("conn"),
    });
    const validationErrors = validateConnectionProfile(normalized);
    const duplicateWarning = findConnectionDuplicate(state.connections, normalized);

    return {
      profile: normalized,
      validationErrors,
      duplicateWarning,
      isValid: !hasValidationErrors(validationErrors),
    };
  }

  function applySnapshot(snapshot: BootstrapState) {
    startTransition(() => {
      setState((current) => {
        const normalizedSnapshot = normalizeBootstrapState(snapshot);
        const mergedSnapshot = {
          ...normalizedSnapshot,
          sessions: mergeSnapshotSessions(current.sessions, normalizedSnapshot.sessions),
        };

        return {
          ...current,
          ...mergedSnapshot,
          ...deriveNextSelection(mergedSnapshot, current.selectedConnectionId, current.activeSessionId),
          pendingHostVerification: current.pendingHostVerification,
          lastHostInspection: current.lastHostInspection,
          isLoading: false,
          error: null,
        };
      });
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
    remoteEntriesRequestRef.current += 1;
    remoteRootEntriesRequestRef.current += 1;
    lastLoadedRemotePathRef.current = null;
    lastLoadedRootSessionRef.current = null;
    setState((current) => ({ ...current, remoteEntries: [], remoteRootEntries: [], remoteEntriesLoading: false }));
  }, [state.activeSessionId]);

  useEffect(() => {
    if (!filesPanelVisible || !state.activeSessionId || activeSessionStatus !== "connected") {
      return;
    }

    const sessionId = state.activeSessionId;
    const pathKey = `${sessionId}:${activeSessionCurrentPath ?? "."}`;
    const shouldRefreshEntries = lastLoadedRemotePathRef.current !== pathKey;
    const shouldRefreshRoot = lastLoadedRootSessionRef.current !== sessionId;

    if (!shouldRefreshEntries && !shouldRefreshRoot) {
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        if (shouldRefreshEntries) {
          lastLoadedRemotePathRef.current = pathKey;
        }

        if (shouldRefreshRoot) {
          lastLoadedRootSessionRef.current = sessionId;
        }

        if (shouldRefreshEntries) {
          await refreshRemoteEntries(sessionId);
        }

        if (shouldRefreshRoot) {
          await refreshRemoteRootEntries(sessionId);
        }
      })();
    }, REMOTE_PANEL_IDLE_REFRESH_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    state.activeSessionId,
    activeSessionCurrentPath,
    activeSessionStatus,
    activeSessionUpdatedAt,
    filesPanelVisible,
    refreshRemoteEntries,
    refreshRemoteRootEntries,
  ]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const flushPendingSessionEvents = () => {
      sessionEventFlushTimerRef.current = null;
      const events = pendingSessionEventsRef.current;
      pendingSessionEventsRef.current = [];

      if (cancelled || events.length === 0) {
        return;
      }

      setState((current) => {
        let sessions = current.sessions;

        for (const event of events) {
          sessions = mergeSessionEvent(sessions, event);
        }

        if (sessions === current.sessions) {
          return current;
        }

        return { ...current, sessions };
      });
    };

    const listener = (event: SessionEvent) => {
      if (cancelled) {
        return;
      }

      pendingSessionEventsRef.current.push(event);
      if (sessionEventFlushTimerRef.current != null) {
        return;
      }

      sessionEventFlushTimerRef.current = window.setTimeout(
        flushPendingSessionEvents,
        SESSION_EVENT_FLUSH_DELAY_MS,
      );
    };

    void desktopClient
      .subscribeSessionEvents(listener)
      .then((unlisten) => {
        if (cancelled) {
          void unlisten();
          return;
        }
        unsubscribe = () => {
          void unlisten();
        };
      })
      .catch((error) => {
        console.error("session event stream error", error);
      });

    return () => {
      cancelled = true;
      pendingSessionEventsRef.current = [];
      if (sessionEventFlushTimerRef.current != null) {
        window.clearTimeout(sessionEventFlushTimerRef.current);
        sessionEventFlushTimerRef.current = null;
      }
      unsubscribe?.();
    };
  }, []);

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
    clearConnectionFeedback,
    selectConnection(connectionId: string) {
      setState((current) => ({ ...current, selectedConnectionId: connectionId }));
    },
    selectSession(sessionId: string) {
      setState((current) => ({ ...current, activeSessionId: sessionId }));
    },
    async saveConnectionProfile(input: Partial<ConnectionProfile>) {
      const { profile, validationErrors, duplicateWarning, isValid } = prepareConnectionProfile(input);

      setConnectionFeedback({
        errors: validationErrors,
        duplicateWarning,
        testResult: null,
        statusMessage: null,
      });

      if (!isValid) {
        return false;
      }

      await runMutation(() => desktopClient.saveConnectionProfile(profile));
      setState((current) => ({
        ...current,
        selectedConnectionId: profile.id,
        connectionValidationErrors: {},
        connectionDuplicateWarning: duplicateWarning,
      }));
      return true;
    },
    async testConnectionProfile(input: Partial<ConnectionProfile>) {
      const { profile, validationErrors, duplicateWarning, isValid } = prepareConnectionProfile(input);

      setConnectionFeedback({
        errors: validationErrors,
        duplicateWarning,
        testResult: null,
        statusMessage: null,
      });

      if (!isValid) {
        return null;
      }

      try {
        const result = await desktopClient.testConnectionProfile(profile);
        setConnectionFeedback({
          errors: {},
          duplicateWarning,
          testResult: result,
          statusMessage: result.message,
        });
        return result;
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : t("errors.unexpectedWorkspace"),
        }));
        return null;
      }
    },
    async deleteConnectionProfile(connectionId: string) {
      await runMutation(() => desktopClient.deleteConnectionProfile(connectionId));
      clearConnectionFeedback();
    },
    async importConnectionProfilesFromJson(content: string) {
      try {
        const result: ConnectionImportResult = await desktopClient.importConnectionProfilesFromJson(content);
        applySnapshot(result.state);
        setConnectionFeedback({
          errors: {},
          duplicateWarning: null,
          testResult: null,
          statusMessage: result.message,
        });
        return result;
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : t("connections.importInvalid"),
        }));
        return null;
      }
    },
    async exportConnectionProfiles(): Promise<ConnectionExportResult | null> {
      try {
        const result = await desktopClient.exportConnectionProfiles();
        setConnectionFeedback({
          statusMessage: t("connections.exportSuccess", { count: result.count }),
        });
        return result;
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : t("errors.connectionExportFailed"),
        }));
        return null;
      }
    },
    async openSession(connectionId: string) {
      setState((current) => ({ ...current, error: null, connectionStatusMessage: null }));

      try {
        const inspection = await desktopClient.inspectConnectionHost(connectionId);

        if (inspection.trustStatus === "trusted") {
          const snapshot = await desktopClient.openSession(connectionId);
          applySnapshot(snapshot);
          const nextActiveSessionId =
            snapshot.sessions.find((item) => item.connectionId === connectionId)?.id ?? snapshot.sessions[0]?.id ?? null;
          setState((current) => ({
            ...current,
            pendingHostVerification: null,
            lastHostInspection: inspection,
            selectedConnectionId: connectionId,
            activeSessionId: nextActiveSessionId,
            connectionStatusMessage: buildHostInspectionMessage(inspection),
          }));
          return;
        }

        setState((current) => ({
          ...current,
          pendingHostVerification: inspection,
          lastHostInspection: inspection,
          connectionStatusMessage: buildHostInspectionMessage(inspection),
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : t("errors.unexpectedWorkspace"),
        }));
      }
    },
    async trustPendingHost() {
      const pending = state.pendingHostVerification;
      if (!pending) {
        return;
      }
      try {
        const inspection = await desktopClient.trustConnectionHost(pending.connectionId, pending.fingerprint);
        setState((current) => ({
          ...current,
          pendingHostVerification: null,
          lastHostInspection: inspection,
        }));
        const snapshot = await desktopClient.openSession(pending.connectionId);
        applySnapshot(snapshot);
        const nextActiveSessionId =
          snapshot.sessions.find((item) => item.connectionId === pending.connectionId)?.id ?? snapshot.sessions[0]?.id ?? null;
        setState((current) => ({
          ...current,
          selectedConnectionId: pending.connectionId,
          activeSessionId: nextActiveSessionId,
          connectionStatusMessage: buildHostInspectionMessage(inspection),
        }));
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : t("errors.unexpectedWorkspace"),
        }));
      }
    },
    dismissPendingHostVerification() {
      setState((current) => ({
        ...current,
        pendingHostVerification: null,
        connectionStatusMessage: null,
      }));
    },
    async reconnectSession(sessionId: string) {
      await runMutation(() => desktopClient.reconnectSession(sessionId));
    },
    async closeSession(sessionId: string) {
      await runMutation(() => desktopClient.closeSession(sessionId));
    },
    async closeOtherSessions(sessionId: string) {
      await runMutation(() => desktopClient.closeOtherSessions(sessionId));
    },
    async clearSessionOutput(sessionId: string) {
      await runMutation(() => desktopClient.clearSessionOutput(sessionId));
    },
    async resizeSession(sessionId: string, cols: number, rows: number) {
      setState((current) => {
        const sessions = updateSessionTerminalSize(current.sessions, sessionId, cols, rows);
        if (sessions === current.sessions) {
          return current;
        }

        return {
          ...current,
          sessions,
          error: null,
        };
      });

      try {
        await desktopClient.resizeSession(sessionId, cols, rows);
      } catch (error) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : t("errors.unexpectedWorkspace"),
        }));
      }
    },
    async sendSessionInput(sessionId: string, input: string) {
      if (!input) {
        return;
      }
      await runMutation(() => desktopClient.sendSessionInput(sessionId, input));
    },
    async openRemoteDirectory(path: string) {
      if (!state.activeSessionId) {
        return;
      }
      await runMutation(() => desktopClient.navigateRemoteDirectory(state.activeSessionId as string, path));
    },
    async goRemoteParent() {
      if (!state.activeSessionId) {
        return;
      }
      await runMutation(() => desktopClient.navigateRemoteToParent(state.activeSessionId as string));
    },
    async refreshRemoteEntriesForActiveSession() {
      if (!state.activeSessionId) {
        return;
      }

      await refreshRemoteEntries(state.activeSessionId);
      await refreshRemoteRootEntries(state.activeSessionId);
    },
    async retryTransfer(task: TransferTask) {
      await runMutation(() => desktopClient.retryTransferTask(task.id));
    },
    async clearCompletedTransfers() {
      await runMutation(() => desktopClient.clearCompletedTransferTasks());
    },
    async uploadFileToCurrentDirectory() {
      const sessionId = state.activeSessionId;
      const currentPath = activeSessionCurrentPath;
      if (!sessionId || !currentPath) {
        return;
      }
      const localPath = requestPathInput(t("files.uploadPrompt"));
      if (!localPath) {
        return;
      }

      const remotePath = joinRemotePath(currentPath, localPathBaseName(localPath));
      await runMutation(() => desktopClient.uploadFileToRemote(sessionId, localPath, remotePath));
      await refreshRemoteEntries(sessionId);
    },
    async downloadRemoteFile(remotePath: string) {
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        return;
      }

      const localPath = requestPathInput(t("files.downloadPrompt"), remotePathBaseName(remotePath));
      if (!localPath) {
        return;
      }

      await runMutation(() => desktopClient.downloadFileFromRemote(sessionId, remotePath, localPath));
    },
    async createRemoteDirectory() {
      const sessionId = state.activeSessionId;
      const currentPath = activeSessionCurrentPath;
      if (!sessionId || !currentPath) {
        return;
      }

      const directoryName = requestPathInput(t("files.newFolderPrompt"));
      if (!directoryName) {
        return;
      }

      const remotePath = joinRemotePath(currentPath, remotePathBaseName(directoryName));
      await runMutation(() => desktopClient.createRemoteDirectory(sessionId, remotePath));
      await refreshRemoteEntries(sessionId);
    },
    async renameRemoteEntry(entry: RemoteFileEntry) {
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        return;
      }

      const nextName = requestPathInput(t("files.renamePrompt", { name: entry.name }), entry.name);
      if (!nextName) {
        return;
      }

      const targetPath = joinRemotePath(parentRemotePath(entry.path), remotePathBaseName(nextName));
      if (targetPath === entry.path) {
        return;
      }

      await runMutation(() => desktopClient.renameRemoteEntry(sessionId, entry.path, targetPath));
      await refreshRemoteEntries(sessionId);
    },
    async deleteRemoteEntry(entry: RemoteFileEntry) {
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        return;
      }

      const confirmed = requestConfirmInput(
        t(entry.kind === "directory" ? "files.deleteDirectoryConfirm" : "files.deleteFileConfirm", {
          name: entry.name,
        }),
      );
      if (!confirmed) {
        return;
      }

      await runMutation(() =>
        desktopClient.deleteRemoteEntry(sessionId, entry.path, entry.kind === "directory"),
      );
      await refreshRemoteEntries(sessionId);
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
      await runMutation(() => desktopClient.saveSettings(normalizeAppSettings(settings)));
    },
    async selectBottomPanel(bottomPanel: BottomPanelId) {
      await runMutation(() =>
        desktopClient.saveSettings({
          ...state.settings,
          workspace: {
            ...state.settings.workspace,
            bottomPanel,
            bottomPanelVisible: true,
          },
        }),
      );
    },
    async toggleBottomPanel() {
      await runMutation(() =>
        desktopClient.saveSettings({
          ...state.settings,
          workspace: {
            ...state.settings.workspace,
            bottomPanelVisible: !state.settings.workspace.bottomPanelVisible,
          },
        }),
      );
    },
    async selectSidePanel(sidePanel: SidePanelId) {
      await runMutation(() =>
        desktopClient.saveSettings({
          ...state.settings,
          workspace: {
            ...state.settings.workspace,
            sidePanel,
            sidePanelVisible: true,
          },
        }),
      );
    },
    async toggleSidePanel() {
      await runMutation(() =>
        desktopClient.saveSettings({
          ...state.settings,
          workspace: {
            ...state.settings.workspace,
            sidePanelVisible: !state.settings.workspace.sidePanelVisible,
          },
        }),
      );
    },
    async updateTheme(theme: ThemeId) {
      await runMutation(() =>
        desktopClient.saveSettings({
          ...state.settings,
          terminal: {
            ...state.settings.terminal,
            theme,
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

function requestPathInput(message: string, defaultValue = ""): string | null {
  if (typeof window === "undefined" || typeof window.prompt !== "function") {
    return null;
  }

  // Native desktop file dialogs can replace this prompt-based fallback later.
  const value = window.prompt(message, defaultValue);
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requestConfirmInput(message: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return false;
  }

  return window.confirm(message);
}

function localPathBaseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function remotePathBaseName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function joinRemotePath(directory: string, name: string): string {
  if (directory === "/") {
    return `/${name}`;
  }

  return `${directory.replace(/\/+$/, "")}/${name}`;
}

function parentRemotePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  const normalized = trimmed.replace(/\/+$/, "");
  const lastSlashIndex = normalized.lastIndexOf("/");
  return lastSlashIndex <= 0 ? "/" : normalized.slice(0, lastSlashIndex);
}
