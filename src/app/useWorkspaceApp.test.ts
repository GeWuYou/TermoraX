import { describe, expect, it } from "vitest";
import type { SessionTab } from "../entities/domain";
import {
  collectCommandHistoryEntries,
  createSessionResizeScheduler,
  mergeSnapshotSessions,
  updateSessionTerminalSize,
} from "./useWorkspaceApp";

function session(overrides?: Partial<SessionTab>): SessionTab {
  return {
    id: "session-1",
    connectionId: "conn-1",
    title: "测试会话",
    protocol: "ssh",
    status: "connected",
    currentPath: "/home/demo",
    lastOutput: "ready",
    terminalCols: 120,
    terminalRows: 32,
    createdAt: "1",
    updatedAt: "1",
    ...overrides,
  };
}

describe("mergeSnapshotSessions", () => {
  it("preserves newer metadata timestamps when a stale snapshot arrives", () => {
    const currentSessions = [session({ updatedAt: "5" })];
    const snapshotSessions = [session({ updatedAt: "4" })];

    const merged = mergeSnapshotSessions(currentSessions, snapshotSessions);

    expect(merged[0].updatedAt).toBe("5");
  });

  it("accepts the snapshot when it already contains the latest metadata", () => {
    const currentSessions = [session({ updatedAt: "4" })];
    const snapshotSessions = [session({ updatedAt: "6" })];

    const merged = mergeSnapshotSessions(currentSessions, snapshotSessions);

    expect(merged[0].updatedAt).toBe("6");
  });

  it("accepts the snapshot when session lifecycle changed during reconnect", () => {
    const currentSessions = [
      session({
        status: "disconnected",
        currentPath: "/home/demo",
        lastOutput: "old prompt\r\n\r\n[TermoraX] SSH 连接已断开。",
        updatedAt: "8",
      }),
    ];
    const snapshotSessions = [
      session({
        status: "connected",
        currentPath: "/",
        lastOutput: "",
        updatedAt: "7",
      }),
    ];

    const merged = mergeSnapshotSessions(currentSessions, snapshotSessions);

    expect(merged[0].status).toBe("connected");
    expect(merged[0].currentPath).toBe("/");
    expect(merged[0].updatedAt).toBe("7");
  });
});

describe("updateSessionTerminalSize", () => {
  it("updates only the matching session dimensions", () => {
    const sessions = [
      session({ id: "session-1", terminalCols: 120, terminalRows: 32 }),
      session({ id: "session-2", terminalCols: 80, terminalRows: 24 }),
    ];

    const updated = updateSessionTerminalSize(sessions, "session-2", 160, 48);

    expect(updated[0]?.terminalCols).toBe(120);
    expect(updated[0]?.terminalRows).toBe(32);
    expect(updated[1]?.terminalCols).toBe(160);
    expect(updated[1]?.terminalRows).toBe(48);
  });

  it("returns the original list when the size is unchanged", () => {
    const sessions = [session({ terminalCols: 120, terminalRows: 32 })];

    const updated = updateSessionTerminalSize(sessions, "session-1", 120, 32);

    expect(updated).toBe(sessions);
  });
});

describe("collectCommandHistoryEntries", () => {
  it("extracts completed commands when enter is received", () => {
    const result = collectCommandHistoryEntries("docker ps", "\r");

    expect(result.nextDraft).toBe("");
    expect(result.commands).toEqual(["docker ps"]);
  });

  it("tracks editable drafts and handles backspace", () => {
    const result = collectCommandHistoryEntries("kubectl get podss", "\u007f\r");

    expect(result.nextDraft).toBe("");
    expect(result.commands).toEqual(["kubectl get pods"]);
  });
});

describe("createSessionResizeScheduler", () => {
  it("coalesces rapid resize bursts and sends only the latest queued size", async () => {
    const calls: string[] = [];
    let resolveFirst = () => {};
    const firstSent = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let invocationCount = 0;
    const scheduler = createSessionResizeScheduler({
      onError() {},
      sendResize: async (_sessionId, cols, rows) => {
        calls.push(`${cols}x${rows}`);
        invocationCount += 1;
        if (invocationCount === 1) {
          await firstSent;
        }
      },
    });

    scheduler.schedule("session-1", 120, 32);
    scheduler.schedule("session-1", 121, 33);
    scheduler.schedule("session-1", 140, 40);

    await Promise.resolve();
    expect(calls).toEqual(["120x32"]);

    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(["120x32", "140x40"]);
  });
});
