import { useMemo } from "react";
import type { RemoteFileEntry } from "../../../entities/domain";
import { Panel } from "../../../shared/components/Panel";
import { t } from "../../../shared/i18n";
import { formatTimestamp } from "../../../shared/lib/time";

interface FilePanelProps {
  entries: RemoteFileEntry[];
  currentPath: string | null;
  loading?: boolean;
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

export function FilePanel({ entries, currentPath, loading = false }: FilePanelProps) {
  const statusMessage = useMemo(() => (loading ? t("files.loading") : t("files.empty")), [loading]);
  const pathLabel = t("files.currentPathLabel");
  const pathDisplay = currentPath ?? t("files.noSession");
  const summaryLabel = loading
    ? t("files.loading")
    : entries.length > 0
    ? t("files.entryCount", { count: entries.length })
    : t("files.empty");

  return (
    <Panel title={t("files.title")} subtitle={pathDisplay}>
      <section className="file-panel__meta">
        <p>
          <span className="file-panel__meta-label">{pathLabel}</span>
          <strong>{pathDisplay}</strong>
        </p>
        <p className="file-panel__meta-count">{summaryLabel}</p>
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
          {entries.map((entry) => (
            <article className="file-row" key={entry.path}>
              <div className="file-row__info">
                <strong>{entry.name}</strong>
                <p>{entry.path}</p>
              </div>
              <div className="file-row__meta">
                <span>{entry.kind === "file" ? t("files.file") : t("files.folder")}</span>
                <span>
                  {entry.kind === "file" ? formatFileSize(entry.size) : t("files.folderSizeUnknown")}
                </span>
                <span>{formatTimestamp(entry.modifiedAt)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
