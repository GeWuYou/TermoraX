import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceController, WorkspaceViewState } from "../../../app/useWorkspaceApp";
import { defaultAppSettings } from "../../settings/model/defaults";
import { WorkspaceShell } from "./WorkspaceShell";

vi.mock("../../terminal/components/TerminalWorkspace", () => ({
  TerminalWorkspace: () => <div data-testid="terminal-workspace">terminal</div>,
}));

function buildState(overrides?: Partial<WorkspaceViewState>): WorkspaceViewState {
  return {
    connections: [],
    sessions: [],
    snippets: [
      {
        id: "snippet-1",
        name: "磁盘检查",
        command: "df -h",
        description: "检查空间占用",
        group: "诊断",
        tags: ["disk"],
        favorite: false,
      },
    ],
    settings: defaultAppSettings,
    extensions: [],
    activity: [],
    transfers: [],
    isLoading: false,
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
    ...overrides,
  };
}

function createController(overrides?: Partial<WorkspaceController>): WorkspaceController {
  const state = buildState();
  const controller: WorkspaceController = {
    state,
    selectedConnection: null,
    activeSession: null,
    clearConnectionFeedback: vi.fn(),
    selectConnection: vi.fn(),
    selectSession: vi.fn(),
    saveConnectionProfile: vi.fn(),
    testConnectionProfile: vi.fn(),
    deleteConnectionProfile: vi.fn(),
    importConnectionProfilesFromJson: vi.fn(),
    exportConnectionProfiles: vi.fn(),
    openSession: vi.fn(),
    trustPendingHost: vi.fn(),
    dismissPendingHostVerification: vi.fn(),
    reconnectSession: vi.fn(),
    closeSession: vi.fn(),
    closeOtherSessions: vi.fn(),
    clearSessionOutput: vi.fn(),
    resizeSession: vi.fn(),
    sendSessionInput: vi.fn(),
    openRemoteDirectory: vi.fn(),
    goRemoteParent: vi.fn(),
    refreshRemoteEntriesForActiveSession: vi.fn(),
    uploadFileToCurrentDirectory: vi.fn(),
    downloadRemoteFile: vi.fn(),
    retryTransfer: vi.fn(),
    clearCompletedTransfers: vi.fn(),
    createRemoteDirectory: vi.fn(),
    renameRemoteEntry: vi.fn(),
    deleteRemoteEntry: vi.fn(),
    saveSnippet: vi.fn(),
    deleteSnippet: vi.fn(),
    runSnippetOnActiveSession: vi.fn(),
    saveSettings: vi.fn(),
    selectBottomPanel: vi.fn(),
    toggleBottomPanel: vi.fn(),
    selectSidePanel: vi.fn(),
    toggleSidePanel: vi.fn(),
    updateTheme: vi.fn(),
    resetSettings: vi.fn(),
  };

  return { ...controller, ...overrides };
}

describe("WorkspaceShell", () => {
  it("renders snippets in the bottom panel when snippets tab is active", () => {
    const controller = createController({
      state: buildState({
        settings: {
          ...defaultAppSettings,
          workspace: {
            ...defaultAppSettings.workspace,
            bottomPanel: "snippets",
          },
        },
      }),
    });

    render(<WorkspaceShell controller={controller} />);

    expect(screen.getByRole("tab", { name: "片段" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "保存片段" })).toBeInTheDocument();
    expect(screen.queryByText("远程文件")).not.toBeInTheDocument();
  });

  it("dispatches bottom tab selection", async () => {
    const user = userEvent.setup();
    const selectBottomPanel = vi.fn();
    const controller = createController({ selectBottomPanel });

    render(<WorkspaceShell controller={controller} />);
    await user.click(screen.getByRole("tab", { name: "片段" }));

    expect(selectBottomPanel).toHaveBeenCalledWith("snippets");
  });
});
