import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilePanel } from "./FilePanel";
import type { RemoteFileEntry } from "../../../entities/domain";

const sampleTimestamp = new Date("2025-01-01T12:00:00Z").toISOString();

const sampleFile: RemoteFileEntry = {
  name: "README.md",
  path: "/home/demo/README.md",
  kind: "file",
  size: 1480,
  modifiedAt: sampleTimestamp,
  createdAt: sampleTimestamp,
  permissions: "644",
  owner: "demo",
  group: "demo",
};

const sampleDir: RemoteFileEntry = {
  name: "deploy",
  path: "/home/demo/deploy",
  kind: "directory",
  size: 0,
  modifiedAt: sampleTimestamp,
  createdAt: sampleTimestamp,
  permissions: "755",
  owner: "demo",
  group: "demo",
};

const rootDir: RemoteFileEntry = {
  name: "home",
  path: "/home",
  kind: "directory",
  size: 0,
  modifiedAt: sampleTimestamp,
  createdAt: sampleTimestamp,
  permissions: "755",
  owner: "root",
  group: "root",
};

describe("FilePanel", () => {
  it("renders loading state", () => {
    render(<FilePanel entries={[]} rootEntries={[]} currentPath={null} loading />);

    expect(screen.getAllByText("正在加载远程目录…").length).toBeGreaterThan(1);
    expect(screen.getAllByText("尚未选择会话").length).toBeGreaterThan(1);
  });

  it("shows empty message when no entries", () => {
    render(<FilePanel entries={[]} rootEntries={[rootDir]} currentPath="/home/demo" />);

    expect(screen.getAllByText("打开会话后会在这里显示远程文件数据。").length).toBeGreaterThan(1);
    expect(screen.getAllByText("当前路径：").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/home/demo").length).toBeGreaterThan(0);
  });

  it("displays directory and file rows with formatted size", () => {
    render(<FilePanel entries={[sampleDir, sampleFile]} rootEntries={[rootDir]} currentPath="/home/demo" />);

    expect(screen.getAllByText("目录").length).toBeGreaterThan(0);
    expect(screen.getAllByText("文件").length).toBeGreaterThan(0);
    expect(screen.getByText("deploy")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("1.4 KB")).toBeInTheDocument();
    expect(screen.getByText("644")).toBeInTheDocument();
    expect(screen.getByText("2 项")).toBeInTheDocument();
  });

  it("keeps parent action disabled when there is no current path or during loading", async () => {
    const user = userEvent.setup();
    const goParent = vi.fn();
    render(<FilePanel entries={[]} rootEntries={[]} currentPath={null} loading onGoParent={goParent} />);

    const parentButton = screen.getByRole("button", { name: "返回上一级" });
    expect(parentButton).toBeDisabled();
    await user.click(parentButton);
    expect(goParent).not.toHaveBeenCalled();
  });

  it("calls callbacks when navigation controls are active", async () => {
    const user = userEvent.setup();
    const goParent = vi.fn();
    const openDirectory = vi.fn();
    render(
      <FilePanel
        entries={[sampleDir, sampleFile]}
        rootEntries={[rootDir]}
        currentPath="/home/demo"
        onGoParent={goParent}
        onOpenDirectory={openDirectory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "返回上一级" }));
    expect(goParent).toHaveBeenCalled();
    await user.dblClick(screen.getByText("deploy"));
    expect(openDirectory).toHaveBeenCalledWith("/home/demo/deploy");
  });

  it("shows file operation buttons when callbacks exist", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    const createDirectory = vi.fn();
    const upload = vi.fn();
    const download = vi.fn();
    const rename = vi.fn();
    const remove = vi.fn();
    render(
      <FilePanel
        entries={[sampleDir, sampleFile]}
        rootEntries={[rootDir]}
        currentPath="/home/demo"
        onRefresh={refresh}
        onCreateDirectory={createDirectory}
        onUpload={upload}
        onDownload={download}
        onRename={rename}
        onDelete={remove}
      />,
    );

    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(refresh).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "新建目录" }));
    expect(createDirectory).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "上传" }));
    expect(upload).toHaveBeenCalled();
    await user.click(screen.getByText("README.md"));
    await user.click(screen.getAllByRole("button", { name: "下载" })[0]);
    expect(download).toHaveBeenCalledWith("/home/demo/README.md");
    await user.click(screen.getAllByRole("button", { name: "重命名" })[0]);
    expect(rename).toHaveBeenCalledWith(sampleDir);
    await user.click(screen.getAllByRole("button", { name: "删除" })[1]);
    expect(remove).toHaveBeenCalledWith(sampleFile);
  });
});
