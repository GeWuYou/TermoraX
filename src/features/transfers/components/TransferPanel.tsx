import { memo } from "react";
import type { TransferTask } from "../../../entities/domain";
import { t } from "../../../shared/i18n";
import { formatTimestamp } from "../../../shared/lib/time";

interface TransferPanelProps {
  tasks: TransferTask[];
  loading?: boolean;
  onRetry?: (task: TransferTask) => void;
  onClearCompleted?: () => void;
}

const statusLabels = {
  running: t("transfers.status.running"),
  succeeded: t("transfers.status.succeeded"),
  failed: t("transfers.status.failed"),
} satisfies Record<TransferTask["status"], string>;

function getTransferProgress(task: TransferTask): number {
  if (task.bytesTotal <= 0) {
    return task.status === "succeeded" ? 100 : 0;
  }

  return Math.max(0, Math.min(100, Math.round((task.bytesTransferred / task.bytesTotal) * 100)));
}

export const TransferPanel = memo(function TransferPanel({
  tasks,
  loading = false,
  onRetry,
  onClearCompleted,
}: TransferPanelProps) {
  const summary = loading
    ? t("transfers.loading")
    : tasks.length > 0
      ? t("transfers.taskCount", { count: tasks.length })
      : t("transfers.empty");
  const hasCompleted = tasks.some((task) => task.status === "succeeded" || task.status === "failed");

  return (
    <section className="panel transfer-panel">
      <header className="panel__header">
        <div>
          <p className="panel__eyebrow">{t("transfers.title")}</p>
          <h2 className="panel__title">{summary}</h2>
        </div>
        {onClearCompleted ? (
          <div>
            <button
              type="button"
              className="ghost-button transfer-row__action"
              onClick={onClearCompleted}
              disabled={loading || !hasCompleted}
              aria-disabled={loading || !hasCompleted}
            >
              {t("transfers.clearCompleted")}
            </button>
          </div>
        ) : null}
      </header>
      <div className="panel__body">
        {loading ? (
          <div className="transfer-panel__state">
            <p>{t("transfers.loading")}</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="empty-panel">
            <p>{t("transfers.empty")}</p>
          </div>
        ) : (
          <div className="transfer-list">
            {tasks.map((task) => (
              <article className="transfer-row" key={task.id}>
                <div className="transfer-row__summary">
                  <strong>{task.direction === "upload" ? task.localPath : task.remotePath}</strong>
                  <span>
                    {task.direction === "upload" ? t("transfers.upload") : t("transfers.download")}
                    {" · "}
                    {statusLabels[task.status]}
                  </span>
                  <p>{task.direction === "upload" ? task.remotePath : task.localPath}</p>
                </div>
                <div className="transfer-row__meta">
                  <div className="transfer-progress">
                    <div className="transfer-progress__fill" style={{ width: `${getTransferProgress(task)}%` }} />
                  </div>
                  <span>{`${task.bytesTransferred} / ${task.bytesTotal || task.bytesTransferred} B`}</span>
                  <span className="transfer-row__time">
                    {formatTimestamp(task.finishedAt ?? task.startedAt)}
                  </span>
                  {task.message ? <span>{task.message}</span> : null}
                  {task.status === "failed" && onRetry ? (
                    <button
                      type="button"
                      className="ghost-button transfer-row__action"
                      onClick={() => onRetry(task)}
                      disabled={loading}
                      aria-disabled={loading}
                    >
                      {t("transfers.retry")}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
});
