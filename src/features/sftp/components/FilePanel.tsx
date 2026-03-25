import type { RemoteFileEntry } from "../../../entities/domain";
import { Panel } from "../../../shared/components/Panel";
import { t } from "../../../shared/i18n";

interface FilePanelProps {
  entries: RemoteFileEntry[];
  currentPath: string | null;
}

export function FilePanel({ entries, currentPath }: FilePanelProps) {
  return (
    <Panel title={t("files.title")} subtitle={currentPath ?? t("files.noSession")}>
      {entries.length === 0 ? (
        <div className="empty-panel">
          <p>{t("files.empty")}</p>
        </div>
      ) : (
        <div className="file-list">
          {entries.map((entry) => (
            <div className="file-row" key={entry.path}>
              <div>
                <strong>{entry.name}</strong>
                <p>{entry.path}</p>
              </div>
              <div className="file-row__meta">
                <span>{entry.kind === "file" ? t("files.file") : t("files.folder")}</span>
                <span>{entry.kind === "file" ? `${entry.size} B` : t("files.folder")}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
