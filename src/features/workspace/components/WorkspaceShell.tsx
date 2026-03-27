import { useCallback, useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import type { ThemeId } from "../../../entities/domain";
import { ConnectionSidebar } from "../../connections/components/ConnectionSidebar";
import { getThemeDefinition } from "../../settings/model/themes";
import { SnippetPanel } from "../../snippets/components/SnippetPanel";
import { FilePanel } from "../../sftp/components/FilePanel";
import { TransferPanel } from "../../transfers/components/TransferPanel";
import { TerminalWorkspace } from "../../terminal/components/TerminalWorkspace";
import { getLocaleState, t } from "../../../shared/i18n";
import { HistoryPanel } from "./HistoryPanel";
import { LogPanel } from "./LogPanel";

interface WorkspaceShellProps {
  controller: WorkspaceController;
}

const MIN_LEFT_PANE_WIDTH = 220;
const MAX_LEFT_PANE_WIDTH = 320;
const MIN_BOTTOM_PANE_HEIGHT = 120;
const MAX_BOTTOM_PANE_HEIGHT = 520;

function clampLeftPaneWidth(value: number): number {
  return Math.min(Math.max(value, MIN_LEFT_PANE_WIDTH), MAX_LEFT_PANE_WIDTH);
}

function clampBottomPaneHeight(value: number): number {
  return Math.min(Math.max(value, MIN_BOTTOM_PANE_HEIGHT), MAX_BOTTOM_PANE_HEIGHT);
}

export function WorkspaceShell({ controller }: WorkspaceShellProps) {
  const { state, activeSession } = controller;
  const localeState = getLocaleState();
  const themeDefinition = getThemeDefinition(state.settings.terminal.theme);
  const runningTransfers = state.transfers.filter((task) => task.status === "running").length;
  const [leftPaneWidth, setLeftPaneWidth] = useState(state.settings.workspace.leftPaneWidth);
  const [bottomPaneHeight, setBottomPaneHeight] = useState(state.settings.workspace.bottomPaneHeight);
  const [toolbarSearch, setToolbarSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createRequestKey, setCreateRequestKey] = useState(0);

  useEffect(() => {
    setLeftPaneWidth(state.settings.workspace.leftPaneWidth);
  }, [state.settings.workspace.leftPaneWidth]);

  useEffect(() => {
    setBottomPaneHeight(state.settings.workspace.bottomPaneHeight);
  }, [state.settings.workspace.bottomPaneHeight]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      const isEditable =
        target?.getAttribute("contenteditable") === "true" ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select";

      if (isEditable || !event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        void controller.toggleLeftPane();
      }

      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        void controller.toggleBottomPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controller]);

  const handleLeftSplitPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = leftPaneWidth;
      let nextWidth = startWidth;

      const onMove = (moveEvent: PointerEvent) => {
        nextWidth = clampLeftPaneWidth(startWidth + moveEvent.clientX - startX);
        setLeftPaneWidth(nextWidth);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        void controller.setLeftPaneWidth(nextWidth);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [controller, leftPaneWidth],
  );

  const handleBottomSplitPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = bottomPaneHeight;

      const onMove = (moveEvent: PointerEvent) => {
        setBottomPaneHeight(clampBottomPaneHeight(startHeight - (moveEvent.clientY - startY)));
      };

      const onUp = (upEvent: PointerEvent) => {
        const nextHeight = clampBottomPaneHeight(startHeight - (upEvent.clientY - startY));
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        void controller.setBottomPaneHeight(nextHeight);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [bottomPaneHeight, controller],
  );

  const toolbarStyle = themeDefinition.variables as CSSProperties;

  function openConnectionEditor() {
    setCreateRequestKey((current) => current + 1);
  }

  function handleBottomPaneTabSelect(panelId: "files" | "snippets" | "history" | "logs") {
    if (state.settings.workspace.bottomPaneVisible && state.settings.workspace.bottomPane === panelId) {
      void controller.toggleBottomPanel();
      return;
    }

    void controller.selectBottomPanel(panelId);
  }

  return (
    <div className="workspace-shell" style={toolbarStyle}>
      <header className="workspace-toolbar">
        <div className="button-row workspace-toolbar__left">
          <button
            className="ghost-button toolbar-button"
            onClick={openConnectionEditor}
            type="button"
          >
            {t("toolbar.newConnection")}
          </button>
          <button
            className="ghost-button toolbar-button"
            onClick={openConnectionEditor}
            type="button"
          >
            {t("toolbar.quickConnect")}
          </button>
          <input
            aria-label={t("toolbar.searchPlaceholder")}
            className="workspace-toolbar__search"
            onChange={(event) => setToolbarSearch(event.target.value)}
            placeholder={t("toolbar.searchPlaceholder")}
            value={toolbarSearch}
          />
        </div>

        <div className="button-row workspace-toolbar__right">
          <button
            className="ghost-button toolbar-button"
            aria-pressed={state.settings.workspace.leftPaneVisible}
            onClick={() => void controller.toggleLeftPane()}
            type="button"
          >
            {t("toolbar.toggleSidebar")}
          </button>
          <button
            className="ghost-button toolbar-button"
            aria-pressed={state.settings.workspace.bottomPaneVisible}
            onClick={() => void controller.toggleBottomPanel()}
            type="button"
          >
            {t("toolbar.toggleTools")}
          </button>
          <div className="workspace-toolbar__settings">
            <button
              className="ghost-button toolbar-button"
              onClick={() => setSettingsOpen((current) => !current)}
              type="button"
            >
              {t("toolbar.settings")}
            </button>
            {settingsOpen ? (
              <div className="workspace-toolbar__settings-menu">
                <label>
                  <span>{t("terminal.themeLabel")}</span>
                  <select
                    aria-label={t("terminal.themeLabel")}
                    onChange={(event) => void controller.updateTheme(event.target.value as ThemeId)}
                    value={state.settings.terminal.theme}
                  >
                    <option value="midnight">{t("workspace.theme.midnight")}</option>
                    <option value="sand">{t("workspace.theme.sand")}</option>
                    <option value="jade">{t("workspace.theme.jade")}</option>
                    <option value="tide">{t("workspace.theme.tide")}</option>
                    <option value="graphite">{t("workspace.theme.graphite")}</option>
                  </select>
                </label>
                <button className="ghost-button toolbar-button" onClick={() => void controller.resetSettings()} type="button">
                  {t("workspace.action.resetSettings")}
                </button>
                {localeState.hasPendingLocaleHook ? (
                  <span className="workspace-toolbar__locale-hint">
                    {t("locale.pendingHook", { locale: localeState.systemLocale })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {state.error ? <div className="error-banner">{state.error}</div> : null}

      <div className="workspace-layout">
        {state.settings.workspace.leftPaneVisible ? (
          <>
            <aside className="workspace-pane workspace-pane--left" style={{ width: `${leftPaneWidth}px` }}>
              <ConnectionSidebar
                controller={controller}
                createRequestKey={createRequestKey}
                onSearchTermChange={setToolbarSearch}
                searchTerm={toolbarSearch}
              />
            </aside>
            <div
              aria-orientation="vertical"
              className="workspace-splitter workspace-splitter--vertical"
              onPointerDown={handleLeftSplitPointerDown}
              role="separator"
            />
          </>
        ) : null}

        <main className="workspace-center">
          <section className="workspace-terminal-pane">
            <TerminalWorkspace controller={controller} />
          </section>

          {state.settings.workspace.bottomPaneVisible ? (
            <>
              <div
                aria-orientation="horizontal"
                className="workspace-splitter workspace-splitter--horizontal"
                onPointerDown={handleBottomSplitPointerDown}
                role="separator"
              />
              <section className="workspace-bottom-pane" style={{ height: `${bottomPaneHeight}px` }}>
                <div className="workspace-tools">
                  <div className="workspace-tools__header">
                    <div className="workspace-tools__tabs" role="tablist">
                      {(["files", "snippets", "history", "logs"] as const).map((panelId) => (
                        <button
                          aria-selected={state.settings.workspace.bottomPane === panelId}
                          className={`workspace-tools__tab ${
                            state.settings.workspace.bottomPane === panelId ? "is-active" : ""
                          }`}
                          key={panelId}
                          onClick={() => handleBottomPaneTabSelect(panelId)}
                          role="tab"
                          type="button"
                        >
                          <span>{t(`workspace.action.${panelId}`)}</span>
                          {panelId === "files" && runningTransfers > 0 ? (
                            <span className="workspace-tools__badge">{runningTransfers}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                    <div className="button-row workspace-tools__actions">
                      <button
                        className="ghost-button toolbar-button"
                        disabled={!activeSession}
                        onClick={() => {
                          void controller.selectBottomPanel("files");
                          void controller.uploadFileToCurrentDirectory();
                        }}
                        type="button"
                      >
                        {t("toolbar.upload")}
                      </button>
                      <button
                        className="ghost-button toolbar-button workspace-tools__close"
                        onClick={() => void controller.toggleBottomPanel()}
                        type="button"
                      >
                        {t("terminal.toggleBottomPanel")}
                      </button>
                    </div>
                  </div>

                  <div className="workspace-tools__content">
                    {state.settings.workspace.bottomPane === "files" ? (
                      <div className="workspace-files-panel">
                        <FilePanel
                          currentPath={activeSession?.currentPath ?? null}
                          entries={state.remoteEntries}
                          loading={state.remoteEntriesLoading}
                          onCreateDirectory={controller.createRemoteDirectory}
                          onDelete={controller.deleteRemoteEntry}
                          onDownload={controller.downloadRemoteFile}
                          onGoParent={controller.goRemoteParent}
                          onOpenDirectory={controller.openRemoteDirectory}
                          onRefresh={controller.refreshRemoteEntriesForActiveSession}
                          onRename={controller.renameRemoteEntry}
                          onUpload={controller.uploadFileToCurrentDirectory}
                          rootEntries={state.remoteRootEntries}
                        />
                        {state.transfers.length > 0 ? (
                          <div className="workspace-files-panel__transfers">
                            <TransferPanel
                              onClearCompleted={controller.clearCompletedTransfers}
                              onRetry={controller.retryTransfer}
                              tasks={state.transfers}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {state.settings.workspace.bottomPane === "snippets" ? (
                      <SnippetPanel controller={controller} />
                    ) : null}
                    {state.settings.workspace.bottomPane === "history" ? (
                      <HistoryPanel controller={controller} />
                    ) : null}
                    {state.settings.workspace.bottomPane === "logs" ? (
                      <LogPanel controller={controller} />
                    ) : null}
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
