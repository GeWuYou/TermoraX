import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TransferPanel } from "./TransferPanel";
import type { TransferTask } from "../../../entities/domain";

const tasks: TransferTask[] = [
  {
    id: "task-1",
    sessionId: "session-1",
    direction: "upload",
    status: "running",
    localPath: "C:/logs/app.log",
    remotePath: "/home/demo/app.log",
    bytesTotal: 2048,
    bytesTransferred: 512,
    startedAt: "2026-01-01T12:00:00.000Z",
    finishedAt: null,
    message: "同步中",
  },
  {
    id: "task-2",
    sessionId: "session-1",
    direction: "download",
    status: "succeeded",
    localPath: "D:/backup/report.txt",
    remotePath: "/srv/report.txt",
    bytesTotal: 4096,
    bytesTransferred: 4096,
    startedAt: "2026-01-01T12:01:00.000Z",
    finishedAt: "2026-01-01T12:01:05.000Z",
    message: null,
  },
  {
    id: "task-3",
    sessionId: "session-1",
    direction: "download",
    status: "failed",
    localPath: "E:/logs/error.log",
    remotePath: "/srv/error.log",
    bytesTotal: 0,
    bytesTransferred: 0,
    startedAt: "2026-01-01T12:02:00.000Z",
    finishedAt: "2026-01-01T12:02:05.000Z",
    message: "网络错误",
  },
];

describe("TransferPanel", () => {
  it("renders loading, empty, and task states", () => {
    render(<TransferPanel tasks={[]} loading />);
    expect(screen.getAllByText("正在获取传输状态…").length).toBeGreaterThan(0);

    render(<TransferPanel tasks={[]} />);
    expect(screen.getAllByText("暂无传输任务。").length).toBeGreaterThan(0);

    render(<TransferPanel tasks={tasks} />);
    expect(screen.getByText("C:/logs/app.log")).toBeInTheDocument();
    expect(screen.getByText("/home/demo/app.log")).toBeInTheDocument();
    expect(screen.getByText("D:/backup/report.txt")).toBeInTheDocument();
    expect(screen.getByText("/srv/report.txt")).toBeInTheDocument();
    expect(screen.getByText("同步中")).toBeInTheDocument();
    expect(screen.getAllByText(/上传 ·/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/下载 ·/).length).toBeGreaterThan(0);
  });

  it("shows correct progress bar width", () => {
    render(<TransferPanel tasks={[tasks[0]]} />);
    const fill = document.querySelector(".transfer-progress__fill") as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toBe("25%");
  });

  it("shows retry button for failed tasks and clear completed action", async () => {
    const retry = vi.fn();
    const clearCompleted = vi.fn();
    render(<TransferPanel tasks={tasks} onRetry={retry} onClearCompleted={clearCompleted} />);

    expect(screen.getByRole("button", { name: "清理已完成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清理已完成" })).not.toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "清理已完成" }));
    expect(clearCompleted).toHaveBeenCalled();

    const retryButtons = screen.getAllByRole("button", { name: "重试" });
    expect(retryButtons.length).toBeGreaterThan(0);
    await userEvent.click(retryButtons[0]);
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ id: "task-3" }));
  });
});
