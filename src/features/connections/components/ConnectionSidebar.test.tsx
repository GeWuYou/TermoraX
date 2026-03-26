import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import type {
  ConnectionImportResult,
  ConnectionProfile,
  ConnectionTestResult,
  HostFingerprintInspection,
  PendingHostVerification,
} from "../../../entities/domain";
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
    password: "secret-1",
    privateKeyPath: "",
    privateKeyPassphrase: "",
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
    password: "",
    privateKeyPath: "~/.ssh/id_web",
    privateKeyPassphrase: "",
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
    password: "secret-2",
    privateKeyPath: "",
    privateKeyPassphrase: "",
    group: "生产",
    tags: ["api"],
    note: "",
    lastConnectedAt: null,
  },
];

function createController(overrides?: Partial<WorkspaceController>): WorkspaceController {
  const controller: WorkspaceController = {
    state: {
      connections: sampleConnections,
      sessions: [],
      snippets: [],
      settings: defaultAppSettings,
      extensions: [],
      activity: [],
      transfers: [],
      isLoading: false,
      error: null,
      selectedConnectionId: "conn-1",
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
    trustPendingHost: async () => undefined,
    dismissPendingHostVerification: () => undefined,
    reconnectSession: async () => undefined,
    closeSession: async () => undefined,
    closeOtherSessions: async () => undefined,
    clearSessionOutput: async () => undefined,
    resizeSession: async () => undefined,
    sendSessionInput: async () => undefined,
    openRemoteDirectory: async () => undefined,
    goRemoteParent: async () => undefined,
    refreshRemoteEntriesForActiveSession: async () => undefined,
    uploadFileToCurrentDirectory: async () => undefined,
    downloadRemoteFile: async () => undefined,
    retryTransfer: async () => undefined,
    clearCompletedTransfers: async () => undefined,
    createRemoteDirectory: async () => undefined,
    renameRemoteEntry: async () => undefined,
    deleteRemoteEntry: async () => undefined,
    saveSnippet: async () => undefined,
    deleteSnippet: async () => undefined,
    runSnippetOnActiveSession: async () => undefined,
    saveSettings: async () => undefined,
    selectBottomPanel: async () => undefined,
    toggleBottomPanel: async () => undefined,
    selectSidePanel: async () => undefined,
    toggleSidePanel: async () => undefined,
    updateTheme: async () => undefined,
    resetSettings: async () => undefined,
  };

  return { ...controller, ...overrides };
}

function inspection(overrides?: Partial<HostFingerprintInspection>): HostFingerprintInspection {
  return {
    connectionId: "conn-1",
    host: "10.0.0.1",
    port: 22,
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:current",
    trustStatus: "untrusted",
    trustedFingerprint: null,
    inspectedAt: "1",
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

  it("displays host fingerprint confirmation when pending verification exists", async () => {
    const user = userEvent.setup();
    const trustSpy = vi.fn(async () => undefined);
    const dismissSpy = vi.fn();
    const inspectionResult = inspection({
      fingerprint: "SHA256:test",
      trustStatus: "mismatch",
      trustedFingerprint: "SHA256:trusted",
    });
    const controller = createController({
      state: {
        ...createController().state,
        pendingHostVerification: inspectionResult as PendingHostVerification,
        lastHostInspection: inspectionResult,
      },
      trustPendingHost: trustSpy,
      dismissPendingHostVerification: dismissSpy,
    });

    render(<ConnectionSidebar controller={controller} />);

    expect(screen.getByText("请确认主机指纹")).toBeInTheDocument();
    expect(screen.getByText("指纹：SHA256:test")).toBeInTheDocument();
    expect(screen.getByText("已信任指纹：SHA256:trusted")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "信任并继续" }));
    await user.click(screen.getByRole("button", { name: "暂不信任" }));
    expect(trustSpy).toHaveBeenCalled();
    expect(dismissSpy).toHaveBeenCalled();
  });
});
