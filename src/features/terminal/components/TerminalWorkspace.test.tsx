import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionTab } from "../../../entities/domain";
import { applySessionOutputEvents, resetSessionOutputStore } from "../../../app/sessionOutputStore";
import { defaultAppSettings } from "../../settings/model/defaults";
import type { WorkspaceController, WorkspaceViewState } from "../../../app/useWorkspaceApp";
import { TerminalWorkspace } from "./TerminalWorkspace";
import { readClipboardText, writeClipboardText } from "../../../shared/lib/clipboard";

const terminalOnDataHandlers: Array<(data: string) => void> = [];
const terminalKeyHandlers: Array<(event: KeyboardEvent) => boolean> = [];
const createdTerminals: Array<{
  dispose: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  scrollLines: ReturnType<typeof vi.fn>;
  scrollToTop: ReturnType<typeof vi.fn>;
  scrollToBottom: ReturnType<typeof vi.fn>;
  buffer: {
    active: {
      baseY: number;
      viewportY: number;
    };
  };
}> = [];
const requestAnimationFrameMock = vi.fn<(callback: FrameRequestCallback) => number>((callback) => {
  callback(0);
  return 1;
});
const cancelAnimationFrameMock = vi.fn();
let terminalSelection = "selected-output";

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);
vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);

Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get() {
    return 960;
  },
});

Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return 640;
  },
});

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
  Terminal: class {
    dispose = vi.fn();
    cols = 120;
    rows = 40;
    buffer = {
      active: {
        baseY: 0,
        viewportY: 0,
      },
    };
    options = {
      theme: undefined,
      fontFamily: undefined,
      fontSize: undefined,
      lineHeight: undefined,
      cursorStyle: undefined,
    };
    private scrollHandlers: Array<() => void> = [];

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
    onScroll(handler: () => void) {
      this.scrollHandlers.push(handler);
      return {
        dispose: () => {
          this.scrollHandlers = this.scrollHandlers.filter((item) => item !== handler);
        },
      };
    }
    hasSelection() {
      return Boolean(terminalSelection);
    }
    getSelection() {
      return terminalSelection;
    }
    clear() {}
    reset = vi.fn(() => {
      this.buffer.active.baseY = 0;
      this.buffer.active.viewportY = 0;
    });
    write = vi.fn((payload: string, callback?: () => void) => {
      const addedLines = (payload.match(/\r\n/g) ?? []).length;
      this.buffer.active.baseY += addedLines;
      callback?.();
    });
    scrollLines = vi.fn((delta: number) => {
      this.buffer.active.viewportY = Math.max(
        0,
        Math.min(this.buffer.active.baseY, this.buffer.active.viewportY + delta),
      );
      this.scrollHandlers.forEach((handler) => handler());
    });
    scrollToTop = vi.fn(() => {
      this.buffer.active.viewportY = 0;
      this.scrollHandlers.forEach((handler) => handler());
    });
    scrollToBottom = vi.fn(() => {
      this.buffer.active.viewportY = this.buffer.active.baseY;
      this.scrollHandlers.forEach((handler) => handler());
    });

    constructor() {
      createdTerminals.push(this);
    }
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  resetSessionOutputStore();
  terminalOnDataHandlers.length = 0;
  terminalKeyHandlers.length = 0;
  createdTerminals.length = 0;
  terminalSelection = "selected-output";
  (readClipboardText as ReturnType<typeof vi.fn>).mockResolvedValue("pasted-command");
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
    commandHistory: [],
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
    selectBottomPanel: vi.fn(),
    toggleBottomPanel: vi.fn(),
    toggleLeftPane: vi.fn(),
    setLeftPaneWidth: vi.fn(),
    setBottomPaneHeight: vi.fn(),
    updateTheme: vi.fn(),
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
    expect(screen.getByText("路径：/home/termorax")).toBeInTheDocument();
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

  test("renders compact terminal actions without a duplicated theme toolbar", () => {
    const controller = createController(sampleSession);

    render(<TerminalWorkspace controller={controller} />);

    expect(screen.queryByRole("combobox", { name: "主题" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "粘贴" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重连" })).toBeInTheDocument();
  });

  test("keeps terminal output instance alive when the theme changes", () => {
    const controller = createController(sampleSession);
    const { rerender } = render(<TerminalWorkspace controller={controller} />);

    expect(createdTerminals).toHaveLength(1);

    const nextController = createController(sampleSession, {
      state: {
        ...controller.state,
        settings: {
          ...controller.state.settings,
          terminal: {
            ...controller.state.settings.terminal,
            theme: "sand",
          },
        },
      },
    });

    rerender(<TerminalWorkspace controller={nextController} />);

    expect(createdTerminals).toHaveLength(1);
    expect(createdTerminals[0]?.dispose).not.toHaveBeenCalled();
  });

  test("shows the current session path from session metadata", () => {
    const controller = createController({
      ...sampleSession,
      currentPath: "/var/www/app",
    });

    render(<TerminalWorkspace controller={controller} />);

    expect(screen.getByText("路径：/var/www/app")).toBeInTheDocument();
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

  test("reports the fitted size on mount but does not resize again for output-only rerenders", async () => {
    const resizeSession = vi.fn();
    const controller = createController(sampleSession, { resizeSession });
    const { rerender } = render(<TerminalWorkspace controller={controller} />);

    await waitFor(() => {
      expect(resizeSession).toHaveBeenCalledTimes(1);
      expect(resizeSession).toHaveBeenCalledWith(sampleSession.id, 120, 40);
    });

    const nextController = createController(
      {
        ...sampleSession,
        lastOutput: "Prompt>\r\nls\r\napp.log",
      },
      {
        resizeSession,
      },
    );

    rerender(<TerminalWorkspace controller={nextController} />);

    await waitFor(() => {
      expect(resizeSession).toHaveBeenCalledTimes(1);
    });
  });

  test("follows output to the bottom without forcing the viewport to the top", async () => {
    const controller = createController(sampleSession);

    render(<TerminalWorkspace controller={controller} />);

    await waitFor(() => {
      expect(createdTerminals[0]?.scrollToBottom).toHaveBeenCalled();
    });
    expect(createdTerminals[0]?.scrollToTop).not.toHaveBeenCalled();

    act(() => {
      applySessionOutputEvents([
        {
          kind: "output",
          sessionId: sampleSession.id,
          stream: "stdout",
          chunk: "\r\npwd",
          occurredAt: "2026-03-25T01:24:00.000Z",
        },
      ]);
    });

    await waitFor(() => {
      expect(createdTerminals[0]?.scrollToBottom).toHaveBeenCalledTimes(2);
    });
    expect(createdTerminals[0]?.scrollToTop).not.toHaveBeenCalled();
  });

  test("keeps the viewport position when the user has scrolled away from the bottom", async () => {
    const controller = createController(sampleSession);

    render(<TerminalWorkspace controller={controller} />);

    await waitFor(() => {
      expect(createdTerminals[0]?.scrollToBottom).toHaveBeenCalledTimes(1);
    });

    const terminal = createdTerminals[0];
    if (!terminal) {
      throw new Error("terminal was not created");
    }

    terminal.buffer.active.baseY = 10;
    terminal.buffer.active.viewportY = 10;

    act(() => {
      terminal.scrollLines(-2);
      applySessionOutputEvents([
        {
          kind: "output",
          sessionId: sampleSession.id,
          stream: "stdout",
          chunk: "\r\nls -la",
          occurredAt: "2026-03-25T01:25:00.000Z",
        },
      ]);
    });

    await waitFor(() => {
      expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
    });
    expect(terminal.scrollToTop).not.toHaveBeenCalled();
  });
});
