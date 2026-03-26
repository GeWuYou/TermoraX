import { describe, expect, it } from "vitest";
import type { SessionEvent, SessionTab } from "../entities/domain";
import { mergeSessionEvent } from "./sessionEvents";

function session(): SessionTab {
  return {
    id: "session-1",
    connectionId: "conn-1",
    title: "测试主机",
    protocol: "ssh",
    status: "connected",
    currentPath: "/home/root",
    lastOutput: "ready",
    terminalCols: 120,
    terminalRows: 32,
    createdAt: "1",
    updatedAt: "1",
  };
}

describe("mergeSessionEvent", () => {
  it("appends output chunks to the matching session", () => {
    const event: SessionEvent = {
      kind: "output",
      sessionId: "session-1",
      stream: "stdout",
      chunk: "\r\nhello",
      occurredAt: "2",
    };

    const updated = mergeSessionEvent([session()], event);

    expect(updated[0].lastOutput).toBe("ready\r\nhello");
    expect(updated[0].updatedAt).toBe("2");
  });

  it("updates status events and appends the status message", () => {
    const event: SessionEvent = {
      kind: "status",
      sessionId: "session-1",
      status: "disconnected",
      message: "\r\nclosed",
      errorCode: null,
      occurredAt: "3",
    };

    const updated = mergeSessionEvent([session()], event);

    expect(updated[0].status).toBe("disconnected");
    expect(updated[0].lastOutput).toBe("ready\r\nclosed");
    expect(updated[0].updatedAt).toBe("3");
  });

  it("keeps only the most recent output suffix when the buffer grows too large", () => {
    const largeChunk = "a".repeat(250_000);
    const event: SessionEvent = {
      kind: "output",
      sessionId: "session-1",
      stream: "stdout",
      chunk: largeChunk,
      occurredAt: "4",
    };

    const updated = mergeSessionEvent([session()], event);

    expect(updated[0].lastOutput.length).toBe(200_000);
    expect(updated[0].lastOutput.endsWith("a".repeat(32))).toBe(true);
  });
});
