import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilePanel } from "./FilePanel";
import type { RemoteFileEntry } from "../../../entities/domain";

const sampleFile: RemoteFileEntry = {
  name: "README.md",
  path: "/home/demo/README.md",
  kind: "file",
  size: 1480,
  modifiedAt: new Date("2025-01-01T12:00:00Z").toISOString(),
};

const sampleDir: RemoteFileEntry = {
  name: "deploy",
  path: "/home/demo/deploy",
  kind: "directory",
  size: 0,
  modifiedAt: new Date("2025-01-01T12:00:00Z").toISOString(),
};

describe("FilePanel", () => {
  it("renders loading state", () => {
    render(<FilePanel entries={[]} currentPath={null} loading />);

    expect(screen.getAllByText("正在加载远程目录…").length).toBeGreaterThan(1);
    expect(screen.getAllByText("尚未选择会话").length).toBeGreaterThan(1);
  });

  it("shows empty message when no entries", () => {
    render(<FilePanel entries={[]} currentPath="/home/demo" />);

    expect(screen.getAllByText("打开会话后会在这里显示远程文件数据。").length).toBeGreaterThan(1);
    expect(screen.getAllByText("当前路径：").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/home/demo").length).toBeGreaterThan(0);
  });

  it("displays directory and file rows with formatted size", () => {
    render(<FilePanel entries={[sampleDir, sampleFile]} currentPath="/home/demo" />);

    expect(screen.getAllByText("目录").length).toBeGreaterThan(0);
    expect(screen.getAllByText("文件").length).toBeGreaterThan(0);
    expect(screen.getByText("deploy")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("1.4 KB")).toBeInTheDocument();
    expect(screen.getByText("2 项")).toBeInTheDocument();
  });
});
