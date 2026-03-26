import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionTab } from "../../../entities/domain";
import { defaultAppSettings } from "../../settings/model/defaults";
import type { WorkspaceController, WorkspaceViewState } from "../../../app/useWorkspaceApp";
import { TerminalWorkspace } from "./TerminalWorkspace";
import { readClipboardText, writeClipboardText } from "../../../shared/lib/clipboard";

const terminalOnDataHandlers: Array<(data: string) => void> = [];
const terminalKeyHandlers: Array<(event: KeyboardEvent) => boolean> = [];
let terminalSelection = "selected-output";
vi.mock("../../../shared/lib/clipboard", () => ({
  writeClipboardText: vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true),
  readClipboardText: vi.fn<() => Promise<string>>().mockResolvedValue("pasted-command"),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit() {}
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    cols = 120;
    rows = 40;
    options = {
      theme: undefined,
      fontFamily: undefined,
      fontSize: undefined,
      lineHeight: undefined,
      cursorStyle: undefined,
    };

    loadAddon() {}
    open() {}
    focus() {}
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      terminalKeyHandlers.push(handler);
    }
    onData(handler: (data: string) => void) {
      terminalOnDataHandlers.push(handler);
      return {
        dispose() {},
      };
    }
    hasSelection() {
      return Boolean(terminalSelection);
    }
    getSelection() {
      return terminalSelection;
    }
    clear() {}
    reset() {}
    write() {}
    scrollLines() {}
    scrollToBottom() {}
    dispose() {}
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  terminalOnDataHandlers.length = 0;
  terminalKeyHandlers.length = 0;
  terminalSelection = "selected-output";
  vi.mocked(readClipboardText).mockResolvedValue("pasted-command");
});

const sampleSession: SessionTab = {
  id: "session-1",
  connectionId: "connection-1",
  title: "测试会话",
  protocol: "ssh",
  status: "connected",
  currentPath: "/home/termorax",
  lastOutput: "Prompt>",
  terminalCols: 120,
  terminalRows: 40,
  createdAt: "2026-03-25T00:00:00.000Z",
  updatedAt: "2026-03-25T01:23:45.000Z",
};

const otherSession: SessionTab = {
  ...sampleSession,
  id: "session-2",
  title: "备用会话",
};

function buildState(session: SessionTab | null): WorkspaceViewState {
  return {
    connections: [],
    sessions: session ? [session] : [],
    snippets: [],
    settings: defaultAppSettings,
    extensions: [],
    activity: [],
    transfers: [],
    isLoading: false,
    error: null,
    selectedConnectionId: null,
    activeSessionId: session?.id ?? null,
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
}

function createController(session: SessionTab | null = sampleSession, overrides?: Partial<WorkspaceController>) {
  const state = buildState(session);
  const controller: WorkspaceController = {
    state,
    selectedConnection: null,
    activeSession: session,
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
    updateRightPanel: vi.fn(),
    toggleRightPanel: vi.fn(),
    toggleTheme: vi.fn(),
    resetSettings: vi.fn(),
  };

  return { ...(controller as WorkspaceController), ...overrides } as WorkspaceController;
}

describe("TerminalWorkspace", () => {
  test("dispatches session actions and surfaces size metadata when available", async () => {
    const reconnectSession = vi.fn();
    const clearSessionOutput = vi.fn();
    const closeOtherSessions = vi.fn();
    const controller = createController(sampleSession, {
      reconnectSession,
      clearSessionOutput,
      closeOtherSessions,
    });

    controller.state.sessions = [sampleSession, otherSession];
    render(<TerminalWorkspace controller={controller} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "重连" }));
    await user.click(screen.getByRole("button", { name: "清屏" }));
    await user.click(screen.getByRole("button", { name: "关闭其它" }));

    expect(reconnectSession).toHaveBeenCalledWith(sampleSession.id);
    expect(clearSessionOutput).toHaveBeenCalledWith(sampleSession.id);
    expect(closeOtherSessions).toHaveBeenCalledWith(sampleSession.id);
    expect(screen.getByText("终端尺寸：120 × 40")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-host")).toBeInTheDocument();
  });

  test("forwards direct terminal input to the controller", async () => {
    const sendSessionInput = vi.fn();
    const controller = createController(sampleSession, { sendSessionInput });

    render(<TerminalWorkspace controller={controller} />);
    expect(terminalOnDataHandlers).toHaveLength(1);

    act(() => {
      terminalOnDataHandlers[0]("l");
      terminalOnDataHandlers[0]("s");
      terminalOnDataHandlers[0]("\r");
    });

    expect(sendSessionInput).toHaveBeenCalledTimes(3);
    expect(sendSessionInput).toHaveBeenNthCalledWith(1, sampleSession.id, "l");
    expect(sendSessionInput).toHaveBeenNthCalledWith(2, sampleSession.id, "s");
    expect(sendSessionInput).toHaveBeenNthCalledWith(3, sampleSession.id, "\r");
  });

  test("pressing enter on a disconnected session triggers reconnect instead of raw input", async () => {
    const reconnectSession = vi.fn();
    const sendSessionInput = vi.fn();
    const controller = createController(
      {
        ...sampleSession,
        status: "disconnected",
      },
      { reconnectSession, sendSessionInput },
    );

    render(<TerminalWorkspace controller={controller} />);
    expect(terminalOnDataHandlers).toHaveLength(1);

    act(() => {
      terminalOnDataHandlers[0]("l");
      terminalOnDataHandlers[0]("\r");
    });

    expect(sendSessionInput).not.toHaveBeenCalled();
    expect(reconnectSession).toHaveBeenCalledTimes(1);
    expect(reconnectSession).toHaveBeenCalledWith(sampleSession.id);
  });

  test("supports copy and paste terminal actions", async () => {
    const sendSessionInput = vi.fn();
    const controller = createController(sampleSession, { sendSessionInput });

    render(<TerminalWorkspace controller={controller} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "复制" }));
    await user.click(screen.getByRole("button", { name: "粘贴" }));

    await waitFor(() => {
      expect(writeClipboardText).toHaveBeenCalledWith("selected-output");
      expect(readClipboardText).toHaveBeenCalled();
      expect(sendSessionInput).toHaveBeenCalledWith(sampleSession.id, "pasted-command");
    });
  });

  test("supports terminal shortcuts for clear and clipboard actions", async () => {
    const clearSessionOutput = vi.fn();
    const sendSessionInput = vi.fn();
    const controller = createController(sampleSession, {
      clearSessionOutput,
      sendSessionInput,
    });

    render(<TerminalWorkspace controller={controller} />);
    expect(terminalKeyHandlers).toHaveLength(1);

    await act(async () => {
      terminalKeyHandlers[0]({
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        key: "l",
      } as KeyboardEvent);
      terminalKeyHandlers[0]({
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        key: "c",
      } as KeyboardEvent);
      terminalKeyHandlers[0]({
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        key: "v",
      } as KeyboardEvent);
    });

    await waitFor(() => {
      expect(clearSessionOutput).toHaveBeenCalledWith(sampleSession.id);
      expect(writeClipboardText).toHaveBeenCalledWith("selected-output");
      expect(sendSessionInput).toHaveBeenCalledWith(sampleSession.id, "pasted-command");
    });
  });

  test("renders the empty stage copy when no session is active", () => {
    const controller = createController(null);

    render(<TerminalWorkspace controller={controller} />);

    expect(screen.getByText("会话区域已准备就绪")).toBeInTheDocument();
    expect(
      screen.getByText("从左侧连接栏打开一个连接，即可开始远程终端工作区会话。"),
    ).toBeInTheDocument();
  });
});
