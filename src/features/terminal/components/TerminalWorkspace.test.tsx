import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { SessionTab } from "../../../entities/domain";
import { defaultAppSettings } from "../../settings/model/defaults";
import type { WorkspaceController, WorkspaceViewState } from "../../../app/useWorkspaceApp";
import { TerminalWorkspace } from "./TerminalWorkspace";

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
    isLoading: false,
    error: null,
    selectedConnectionId: null,
    activeSessionId: session?.id ?? null,
    remoteEntries: [],
    connectionValidationErrors: {},
    connectionDuplicateWarning: null,
    connectionTestResult: null,
    connectionStatusMessage: null,
  };
}

function createController(session: SessionTab | null = sampleSession, overrides?: Partial<WorkspaceController>) {
  const state = buildState(session);
  const controller: Partial<WorkspaceController> = {
    state,
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
    reconnectSession: vi.fn(),
    closeSession: vi.fn(),
    closeOtherSessions: vi.fn(),
    clearSessionOutput: vi.fn(),
    resizeSession: vi.fn(),
    sendSessionInput: vi.fn(),
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
  });

  test("submits command input and clears the field", async () => {
    const sendSessionInput = vi.fn();
    const controller = createController(sampleSession, { sendSessionInput });

    render(<TerminalWorkspace controller={controller} />);

    const user = userEvent.setup();
    const commandInput = screen.getByPlaceholderText("输入命令");
    await user.type(commandInput, " ls -al  ");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(sendSessionInput).toHaveBeenCalledWith(sampleSession.id, "ls -al");
    expect(commandInput).toHaveValue("");
  });

  test("renders the empty stage copy when no session is active", () => {
    const controller = createController(null);

    render(<TerminalWorkspace controller={controller} />);

    expect(screen.getByText("会话区域已准备就绪")).toBeInTheDocument();
    expect(
      screen.getByText(
        "从左侧连接栏打开一个连接。当前构建使用模拟传输层，但真实的 Tauri 命令边界和状态流已经就位。",
      ),
    ).toBeInTheDocument();
  });
});
