import { describe, expect, it } from "vitest";
import { normalizeRemoteFileEntry } from "./client";

describe("normalizeRemoteFileEntry", () => {
  it("accepts snake_case payloads from the Tauri boundary", () => {
    const entry = normalizeRemoteFileEntry({
      name: "README.md",
      path: "/home/demo/README.md",
      kind: "file",
      size: 1480,
      modified_at: "1711111111000",
      created_at: "1711111110000",
      permissions: "644",
      owner: "deploy",
      group: "ops",
    });

    expect(entry).toEqual({
      name: "README.md",
      path: "/home/demo/README.md",
      kind: "file",
      size: 1480,
      modifiedAt: "1711111111000",
      createdAt: "1711111110000",
      permissions: "644",
      owner: "deploy",
      group: "ops",
    });
  });

  it("falls back to the path basename when the payload name is missing", () => {
    const entry = normalizeRemoteFileEntry({
      path: "/var/log/messages",
      kind: "file",
      size: "512",
    });

    expect(entry.name).toBe("messages");
    expect(entry.size).toBe(512);
    expect(entry.permissions).toBeNull();
  });
});
