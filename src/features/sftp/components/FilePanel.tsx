import {
  FormEvent,
  PointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RemoteFileEntry } from "../../../entities/domain";
import { Panel } from "../../../shared/components/Panel";
import { t } from "../../../shared/i18n";
import { formatTimestamp } from "../../../shared/lib/time";

interface FilePanelProps {
  entries: RemoteFileEntry[];
  rootEntries: RemoteFileEntry[];
  currentPath: string | null;
  layoutScale?: number;
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

const MIN_DIRECTORY_WIDTH = 180;

function formatFileSize(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.round(size)}${units[unitIndex]}`;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function normalizeIdentityPart(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatOwnerGroup(owner: string | null | undefined, group: string | null | undefined): string {
  const normalizedOwner = normalizeIdentityPart(owner);
  const normalizedGroup = normalizeIdentityPart(group);

  if (!normalizedOwner && !normalizedGroup) {
    return "-/-";
  }

  if (normalizedOwner === "0" && normalizedGroup === "0") {
    return "root/root";
  }

  return `${normalizedOwner ?? "-"}/${normalizedGroup ?? "-"}`;
}

function resolveRootDirectorySelection(currentPath: string | null, rootEntries: RemoteFileEntry[]): string | null {
  if (rootEntries.length === 0) {
    return null;
  }

  if (!currentPath || currentPath === "/") {
    return rootEntries[0]?.path ?? null;
  }

  const segments = currentPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return rootEntries[0]?.path ?? null;
  }

  const rootPath = `/${segments[0]}`;
  return rootEntries.find((entry) => entry.path === rootPath)?.path ?? rootEntries[0]?.path ?? null;
}

export function FilePanel(props: FilePanelProps) {
  const {
    entries,
    rootEntries,
    currentPath,
    layoutScale = 1,
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

  const [pathDraft, setPathDraft] = useState(currentPath ?? "");
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null);
  const [directoryWidth, setDirectoryWidth] = useState(280);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const directoryListRef = useRef<HTMLDivElement | null>(null);
  const fileTableBodyRef = useRef<HTMLDivElement | null>(null);

  const rootDirectories = useMemo(() => rootEntries.filter((entry) => entry.kind === "directory"), [rootEntries]);
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.path === selectedEntryPath) ?? null,
    [entries, selectedEntryPath],
  );
  useEffect(() => {
    setPathDraft(currentPath ?? "");
    setSelectedDirectory(resolveRootDirectorySelection(currentPath, rootDirectories));
    setSelectedEntryPath(null);
  }, [currentPath, rootDirectories]);

  const statusMessage = useMemo(() => (loading ? t("files.loading") : t("files.empty")), [loading]);
  const pathLabel = t("files.currentPathLabel");
  const summaryLabel = loading
    ? t("files.loading")
    : entries.length > 0
    ? t("files.entryCount", { count: entries.length })
    : t("files.empty");

  const handlePathSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = pathDraft.trim();
      if (!trimmed || !onOpenDirectory) {
        return;
      }
      onOpenDirectory(trimmed);
    },
    [onOpenDirectory, pathDraft],
  );

  const openDirectory = useCallback(
    (path: string) => {
      setSelectedDirectory(path);
      onOpenDirectory?.(path);
    },
    [onOpenDirectory],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!splitRef.current) {
        return;
      }
      if (typeof window === "undefined") {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startWidth = directoryWidth;
      const containerWidth = splitRef.current.clientWidth;

      const onMove = (moveEvent: PointerEvent) => {
        const delta = (moveEvent.clientX - startX) / layoutScale;
        const maxWidth = Math.max(containerWidth - MIN_DIRECTORY_WIDTH, MIN_DIRECTORY_WIDTH);
        const nextWidth = Math.min(Math.max(startWidth + delta, MIN_DIRECTORY_WIDTH), maxWidth);
        setDirectoryWidth(nextWidth);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove as unknown as EventListener);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove as unknown as EventListener);
      window.addEventListener("pointerup", onUp);
    },
    [directoryWidth, layoutScale],
  );

  const iconButton = (label: string, onClick?: () => void, disabled?: boolean, icon?: string) => (
    <button
      type="button"
      className="ghost-button file-panel__icon-button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={label}
    >
      <span aria-hidden="true">{icon ?? "●"}</span>
      <span className="sr-only">{label}</span>
    </button>
  );

  const forwardWheelToActiveList = useCallback((event: ReactWheelEvent<HTMLElement>) => {
    const fileBody = fileTableBodyRef.current;
    const directoryList = directoryListRef.current;
    const targets = [fileBody, directoryList].filter((value): value is HTMLDivElement => Boolean(value));

    for (const target of targets) {
      const maxScrollTop = target.scrollHeight - target.clientHeight;
      if (maxScrollTop <= 0) {
        continue;
      }

      const nextScrollTop = Math.min(Math.max(target.scrollTop + event.deltaY, 0), maxScrollTop);
      if (nextScrollTop !== target.scrollTop) {
        target.scrollTop = nextScrollTop;
        event.preventDefault();
        return;
      }
    }
  }, []);

  return (
    <Panel title={t("files.title")} className="file-panel">
      <div className="file-panel__tabs-row" onWheel={forwardWheelToActiveList}>
        <div>
          <button type="button" className="file-panel__tab file-panel__tab--active">
            {t("files.tab.files")}
          </button>
          <button type="button" className="file-panel__tab file-panel__tab--disabled" disabled>
            {t("files.tab.transfers")}
          </button>
        </div>
        <p className="file-panel__meta-count">{summaryLabel}</p>
      </div>

      <form className="file-panel__path-row" onSubmit={handlePathSubmit} onWheel={forwardWheelToActiveList}>
        <label className="sr-only" htmlFor="file-panel-path">
          {pathLabel}
        </label>
        <input
          id="file-panel-path"
          type="text"
          value={pathDraft}
          onChange={(event) => setPathDraft(event.target.value)}
          disabled={!currentPath || loading}
          placeholder={currentPath ? t("files.pathPlaceholder") : t("files.noSession")}
          className="file-panel__path-input"
        />
        <div className="file-panel__icon-buttons">
          {iconButton(t("files.refresh"), onRefresh, loading || !currentPath || !onRefresh, "⟳")}
          {iconButton(t("files.upload"), onUpload, loading || !onUpload, "⇧")}
          {iconButton(
            t("files.download"),
            selectedEntry && selectedEntry.kind === "file" && onDownload
              ? () => onDownload(selectedEntry.path)
              : undefined,
            loading || !onDownload || !selectedEntry || selectedEntry.kind !== "file",
            "⇩",
          )}
          {iconButton(
            t("files.newFolder"),
            onCreateDirectory,
            loading || !onCreateDirectory,
            "📁✚",
          )}
          <button
            type="button"
            className="ghost-button file-panel__icon-button"
            onClick={onGoParent}
            disabled={!currentPath || loading || !onGoParent}
          >
            <span aria-hidden="true">↖</span>
            <span className="sr-only">{t("files.goParent")}</span>
          </button>
        </div>
      </form>

      {loading ? (
        <div className="file-panel__state">
          <p>{statusMessage}</p>
        </div>
      ) : (
        <div
          className="file-panel__split"
          ref={splitRef}
          style={{ gridTemplateColumns: `${directoryWidth}px 8px minmax(0, 1fr)` }}
        >
          <section className="file-panel__directories">
            <header className="file-panel__directories-header">
              <strong>{t("files.directories")}</strong>
              <span>{t("files.entryCount", { count: rootDirectories.length })}</span>
            </header>
            <div className="file-panel__directories-list" ref={directoryListRef}>
              {rootDirectories.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={`file-panel__directory-row ${
                    selectedDirectory === entry.path ? "file-panel__directory-row--active" : ""
                  }`}
                  onClick={() => setSelectedDirectory(entry.path)}
                  onDoubleClick={() => openDirectory(entry.path)}
                  disabled={loading}
                >
                  <span className="file-panel__directory-icon">📁</span>
                  <span>{entry.name}</span>
                </button>
              ))}
              {rootDirectories.length === 0 ? (
                <p className="file-panel__directories-empty">{t("files.directoryEmpty")}</p>
              ) : null}
            </div>
          </section>

          <div
            className="file-panel__split-handle"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={handlePointerDown}
          />

          <section className="file-panel__files">
            {!entries.length ? (
              <div className="empty-panel">
                <p>{statusMessage}</p>
              </div>
            ) : (
              <div className="file-table">
                <header className="file-table__header" onWheel={forwardWheelToActiveList}>
                  <span>{t("files.name")}</span>
                  <span>{t("files.size")}</span>
                  <span>{t("files.type")}</span>
                  <span>{t("files.modifiedAt")}</span>
                  <span>{t("files.actions")}</span>
                </header>
                <div className="file-table__body" ref={fileTableBodyRef}>
                {entries.map((entry) => {
                  const typeLabel = entry.kind === "file" ? t("files.file") : t("files.folder");
                  const sizeLabel = formatFileSize(entry.size);
                  const ownerGroup = formatOwnerGroup(entry.owner, entry.group);
                  const permissions = entry.permissions ?? t("files.unknown");
                  const isSelected = selectedEntryPath === entry.path;
                  return (
                    <article
                      className={`file-table__row ${isSelected ? "file-table__row--selected" : ""}`}
                      key={entry.path}
                      onClick={() => setSelectedEntryPath(entry.path)}
                      onDoubleClick={() => {
                        if (!loading && entry.kind === "directory" && onOpenDirectory) {
                          openDirectory(entry.path);
                        }
                      }}
                    >
                      <div className="file-table__cell file-table__cell--name">
                        <span className="file-table__name-icon" aria-hidden="true">
                          {entry.kind === "directory" ? "📁" : "📄"}
                        </span>
                        <div className="file-table__name-copy">
                          <strong>{entry.name}</strong>
                          <p>{entry.path}</p>
                          <span className="file-table__name-meta">
                            {entry.createdAt ? `${t("files.createdAt")} ${formatTimestamp(entry.createdAt)}` : null}
                            {entry.createdAt ? " · " : ""}
                            {t("files.permissions")} {permissions}
                            {" · "}
                            {t("files.ownerGroup")} {ownerGroup}
                          </span>
                        </div>
                      </div>
                      <span className="file-table__cell">{sizeLabel}</span>
                      <span className="file-table__cell">{typeLabel}</span>
                      <span className="file-table__cell">{formatTimestamp(entry.modifiedAt)}</span>
                      <div className="file-table__cell file-table__cell--actions">
                        {entry.kind === "file" && onDownload ? (
                          <button
                            type="button"
                            className="ghost-button file-item__action-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDownload(entry.path);
                            }}
                            disabled={loading}
                            aria-disabled={loading}
                          >
                            {t("files.download")}
                          </button>
                        ) : null}
                        {onRename ? (
                          <button
                            type="button"
                            className="ghost-button file-item__action-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onRename(entry);
                            }}
                            disabled={loading}
                            aria-disabled={loading}
                          >
                            {t("files.rename")}
                          </button>
                        ) : null}
                        {onDelete ? (
                          <button
                            type="button"
                            className="ghost-button file-item__action-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDelete(entry);
                            }}
                            disabled={loading}
                            aria-disabled={loading}
                          >
                            {t("files.delete")}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </Panel>
  );
}
