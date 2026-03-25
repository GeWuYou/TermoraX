import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import type { ConnectionImportResult, ConnectionProfile, ConnectionTestResult } from "../../../entities/domain";
import { defaultAppSettings } from "../../settings/model/defaults";
import { ConnectionSidebar } from "./ConnectionSidebar";

const sampleConnections: ConnectionProfile[] = [
  {
    id: "conn-1",
    name: "生产 API",
    host: "10.0.0.1",
    port: 22,
    username: "deploy",
    authType: "password",
    group: "生产",
    tags: ["api"],
    note: "",
    lastConnectedAt: "200",
  },
  {
    id: "conn-2",
    name: "预发 Web",
    host: "10.0.1.2",
    port: 22,
    username: "ops",
    authType: "privateKey",
    group: "预发",
    tags: ["web"],
    note: "",
    lastConnectedAt: "100",
  },
  {
    id: "conn-3",
    name: "生产 API 副本",
    host: "10.0.0.1",
    port: 22,
    username: "deploy",
    authType: "password",
    group: "生产",
    tags: ["api"],
    note: "",
    lastConnectedAt: null,
  },
];

function createController(overrides?: Partial<WorkspaceController>): WorkspaceController {
  return {
    state: {
      connections: sampleConnections,
      sessions: [],
      snippets: [],
      settings: defaultAppSettings,
      extensions: [],
      activity: [],
      isLoading: false,
      error: null,
      selectedConnectionId: "conn-1",
      activeSessionId: null,
      remoteEntries: [],
      connectionValidationErrors: {},
      connectionDuplicateWarning: null,
      connectionTestResult: null,
      connectionStatusMessage: null,
    },
    selectedConnection: sampleConnections[0],
    activeSession: null,
    clearConnectionFeedback: () => undefined,
    selectConnection: () => undefined,
    selectSession: () => undefined,
    saveConnectionProfile: async () => true,
    testConnectionProfile: async (): Promise<ConnectionTestResult | null> => null,
    deleteConnectionProfile: async () => undefined,
    importConnectionProfilesFromJson: async (): Promise<ConnectionImportResult | null> => null,
    exportConnectionProfiles: async () => null,
    openSession: async () => undefined,
    reconnectSession: async () => undefined,
    closeSession: async () => undefined,
    closeOtherSessions: async () => undefined,
    clearSessionOutput: async () => undefined,
    resizeSession: async () => undefined,
    sendSessionInput: async () => undefined,
    saveSnippet: async () => undefined,
    deleteSnippet: async () => undefined,
    runSnippetOnActiveSession: async () => undefined,
    saveSettings: async () => undefined,
    updateRightPanel: async () => undefined,
    toggleRightPanel: async () => undefined,
    toggleTheme: async () => undefined,
    resetSettings: async () => undefined,
    ...overrides,
  };
}

describe("ConnectionSidebar", () => {
  it("filters connections by search term", async () => {
    const user = userEvent.setup();
    render(<ConnectionSidebar controller={createController()} />);

    await user.type(screen.getByPlaceholderText("搜索名称、主机、用户或标签"), "预发");

    expect(screen.getByText("预发 Web")).toBeInTheDocument();
    expect(screen.queryByText("生产 API")).not.toBeInTheDocument();
  });

  it("shows duplicate connection warning when duplicate signatures exist", () => {
    render(<ConnectionSidebar controller={createController()} />);

    expect(screen.getAllByText("发现重复连接配置，请检查 host:port@user：").length).toBeGreaterThan(0);
    expect(screen.getAllByText("10.0.0.1:22@deploy").length).toBeGreaterThan(0);
  });

  it("reveals delete confirmation after clicking delete", async () => {
    const user = userEvent.setup();
    render(<ConnectionSidebar controller={createController()} />);

    await user.click(screen.getAllByRole("button", { name: "删除" })[0]);

    expect(screen.getByText("确认删除连接配置")).toBeInTheDocument();
    expect(screen.getByText("删除后将同时移除关联会话。此操作不可撤销。")).toBeInTheDocument();
  });
});
