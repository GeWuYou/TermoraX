import { startTransition, useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
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
  RightPanelId,
  SessionEvent,
  SessionTab,
  TransferTask,
} from "../entities/domain";
import { desktopClient } from "../integrations/tauri/client";
import { defaultAppSettings } from "../features/settings/model/defaults";
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
  remoteEntriesLoading: false,
  connectionValidationErrors: {},
  connectionDuplicateWarning: null,
  connectionTestResult: null,
  connectionStatusMessage: null,
  pendingHostVerification: null,
  lastHostInspection: null,
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

    if (!currentExtendsSnapshot && !currentIsNewer) {
      return snapshotSession;
    }

    return {
      ...snapshotSession,
      lastOutput: currentSession.lastOutput,
      updatedAt: currentIsNewer ? currentSession.updatedAt : snapshotSession.updatedAt,
    };
  });
}

export function useWorkspaceApp() {
  const [state, setState] = useState<WorkspaceState>(initialState);
  const activeSessionCurrentPath =
    state.sessions.find((item) => item.id === state.activeSessionId)?.currentPath ?? null;

  async function refreshRemoteEntries(sessionId: string) {
    setState((current) => ({ ...current, remoteEntriesLoading: true }));
    try {
      const remoteEntries = await desktopClient.listRemoteEntries(sessionId);
      setState((current) => ({ ...current, remoteEntries, remoteEntriesLoading: false }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : t("errors.remoteEntries"),
        remoteEntriesLoading: false,
      }));
    }
  }

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
        const mergedSnapshot = {
          ...snapshot,
          sessions: mergeSnapshotSessions(current.sessions, snapshot.sessions),
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
    setState((current) => ({ ...current, remoteEntries: [], remoteEntriesLoading: false }));
  }, [state.activeSessionId]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const listener = (event: SessionEvent) => {
      if (cancelled) {
        return;
      }
      setState((current) => {
        const updatedSessions = mergeSessionEvent(current.sessions, event);
        if (updatedSessions === current.sessions) {
          return current;
        }
        return { ...current, sessions: updatedSessions };
      });
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
          await runMutation(() => desktopClient.openSession(connectionId));
          setState((current) => ({
            ...current,
            pendingHostVerification: null,
            lastHostInspection: inspection,
            selectedConnectionId: connectionId,
            activeSessionId:
              current.sessions.find((item) => item.connectionId === connectionId)?.id ?? current.activeSessionId,
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
        await runMutation(() => desktopClient.openSession(pending.connectionId));
        setState((current) => ({
          ...current,
          selectedConnectionId: pending.connectionId,
          activeSessionId:
            current.sessions.find((item) => item.connectionId === pending.connectionId)?.id ?? current.activeSessionId,
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
      await runMutation(() => desktopClient.resizeSession(sessionId, cols, rows));
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
      await refreshRemoteEntries(state.activeSessionId);
    },
    async refreshRemoteEntriesForActiveSession() {
      if (!state.activeSessionId) {
        return;
      }

      await refreshRemoteEntries(state.activeSessionId);
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
