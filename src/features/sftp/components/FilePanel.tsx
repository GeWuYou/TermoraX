import { useMemo } from "react";
import type { RemoteFileEntry } from "../../../entities/domain";
import { Panel } from "../../../shared/components/Panel";
import { t } from "../../../shared/i18n";
import { formatTimestamp } from "../../../shared/lib/time";

interface FilePanelProps {
  entries: RemoteFileEntry[];
  currentPath: string | null;
  loading?: boolean;
  onRefresh?: () => void;
  onOpenDirectory?: (path: string) => void;
  onGoParent?: () => void;
  onUpload?: () => void;
  onCreateDirectory?: () => void;
  onDownload?: (path: string) => void;
  onRename?: (entry: RemoteFileEntry) => void;
  onDelete?: (entry: RemoteFileEntry) => void;
}

function formatFileSize(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let size = value;
  let unitIndex = 0;

  // Convert bytes to the largest fitting unit, keeping one decimal place for KB+.
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.round(size)} ${units[unitIndex]}`;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function FilePanel(props: FilePanelProps) {
  const {
    entries,
    currentPath,
    loading = false,
    onRefresh,
    onOpenDirectory,
    onGoParent,
    onUpload,
    onCreateDirectory,
    onDownload,
    onRename,
    onDelete,
  } = props;
  const statusMessage = useMemo(() => (loading ? t("files.loading") : t("files.empty")), [loading]);
  const pathLabel = t("files.currentPathLabel");
  const pathDisplay = currentPath ?? t("files.noSession");
  const summaryLabel = loading
    ? t("files.loading")
    : entries.length > 0
    ? t("files.entryCount", { count: entries.length })
    : t("files.empty");

  return (
    <Panel title={t("files.title")} subtitle={pathDisplay} className="file-panel">
      <section className="file-panel__meta">
        <p>
          <span className="file-panel__meta-label">{pathLabel}</span>
          <strong>{pathDisplay}</strong>
        </p>
        <p className="file-panel__meta-count">{summaryLabel}</p>
        <div className="file-panel__meta-actions">
          {onRefresh ? (
            <button
              type="button"
              className="ghost-button file-panel__action-button"
              onClick={onRefresh}
              disabled={loading || !currentPath}
              aria-disabled={loading || !currentPath}
            >
              {t("files.refresh")}
            </button>
          ) : null}
          {onCreateDirectory ? (
            <button
              type="button"
              className="ghost-button file-panel__action-button"
              onClick={onCreateDirectory}
              disabled={loading}
              aria-disabled={loading}
            >
              {t("files.newFolder")}
            </button>
          ) : null}
          {onUpload ? (
            <button
              type="button"
              className="ghost-button file-panel__action-button"
              onClick={onUpload}
              disabled={loading}
              aria-disabled={loading}
            >
              {t("files.upload")}
            </button>
          ) : null}
          <button
            type="button"
            className="file-panel__parent-button"
            onClick={onGoParent}
            disabled={!currentPath || loading || !onGoParent}
            aria-disabled={!currentPath || loading || !onGoParent}
          >
            {t("files.goParent")}
          </button>
        </div>
      </section>

      {loading ? (
        <div className="file-panel__state">
          <p>{statusMessage}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-panel">
          <p>{statusMessage}</p>
        </div>
      ) : (
        <div className="file-list">
          <header className="file-list__header">
            <span>{t("files.name")}</span>
            <span>{t("files.type")}</span>
            <span>{t("files.size")}</span>
            <span>{t("files.modifiedAt")}</span>
          </header>
          {entries.map((entry) => {
            const isDirectory = entry.kind === "directory";
            return (
              <article className="file-row" key={entry.path}>
                {isDirectory ? (
                  <button
                    type="button"
                    className="file-row__info file-row__info-button"
                    onClick={() => {
                      if (!loading && onOpenDirectory) {
                        onOpenDirectory(entry.path);
                      }
                    }}
                    disabled={loading || !onOpenDirectory}
                    aria-disabled={loading || !onOpenDirectory}
                  >
                    <strong>{entry.name}</strong>
                    <p>{entry.path}</p>
                  </button>
                ) : (
                  <div className="file-row__info">
                    <strong>{entry.name}</strong>
                    <p>{entry.path}</p>
                  </div>
                )}
                <div className="file-row__meta">
                  <span>{entry.kind === "file" ? t("files.file") : t("files.folder")}</span>
                  <span>
                    {entry.kind === "file" ? formatFileSize(entry.size) : t("files.folderSizeUnknown")}
                  </span>
                  <span>{formatTimestamp(entry.modifiedAt)}</span>
                  <div className="file-row__actions">
                    {entry.kind === "file" && onDownload ? (
                      <button
                        type="button"
                        className="ghost-button file-row__download"
                        onClick={() => onDownload(entry.path)}
                        disabled={loading}
                        aria-disabled={loading}
                      >
                        {t("files.download")}
                      </button>
                    ) : null}
                    {onRename ? (
                      <button
                        type="button"
                        className="ghost-button file-row__download"
                        onClick={() => onRename(entry)}
                        disabled={loading}
                        aria-disabled={loading}
                      >
                        {t("files.rename")}
                      </button>
                    ) : null}
                    {onDelete ? (
                      <button
                        type="button"
                        className="ghost-button file-row__download"
                        onClick={() => onDelete(entry)}
                        disabled={loading}
                        aria-disabled={loading}
                      >
                        {t("files.delete")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
