import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import { ConnectionSidebar } from "../../connections/components/ConnectionSidebar";
import { SnippetPanel } from "../../snippets/components/SnippetPanel";
import { FilePanel } from "../../sftp/components/FilePanel";
import { TerminalWorkspace } from "../../terminal/components/TerminalWorkspace";
import { formatTimestamp } from "../../../shared/lib/time";
import { getLocaleState, t } from "../../../shared/i18n";

interface WorkspaceShellProps {
  controller: WorkspaceController;
}

export function WorkspaceShell({ controller }: WorkspaceShellProps) {
  const { state, activeSession } = controller;
  const localeState = getLocaleState();

  return (
    <div className={`workspace workspace--${state.settings.terminal.theme}`}>
      <header className="workspace-topbar">
        <div>
          <p className="workspace-topbar__eyebrow">{t("app.name")}</p>
          <h1>{t("workspace.title")}</h1>
          {localeState.hasPendingLocaleHook ? (
            <p className="workspace-locale-hint">
              {t("locale.pendingHook", { locale: localeState.systemLocale })}
            </p>
          ) : null}
        </div>
        <div className="workspace-topbar__stats">
          <div>
            <strong>{state.connections.length}</strong>
            <span>{t("workspace.metric.connections")}</span>
          </div>
          <div>
            <strong>{state.sessions.length}</strong>
            <span>{t("workspace.metric.sessions")}</span>
          </div>
          <div>
            <strong>{state.extensions.length}</strong>
            <span>{t("workspace.metric.extensions")}</span>
          </div>
        </div>
      </header>

      {state.error ? <div className="error-banner">{state.error}</div> : null}

      <div className="workspace-grid">
        <aside className="workspace-sidebar">
          <ConnectionSidebar controller={controller} />
        </aside>

        <main className="workspace-main">
          <TerminalWorkspace controller={controller} />
        </main>

        {state.settings.workspace.rightPanelVisible ? (
          <aside className="workspace-right">
            {state.settings.workspace.rightPanel === "files" ? (
              <FilePanel currentPath={activeSession?.currentPath ?? null} entries={state.remoteEntries} />
            ) : null}
            {state.settings.workspace.rightPanel === "snippets" ? <SnippetPanel controller={controller} /> : null}
            {state.settings.workspace.rightPanel === "activity" ? (
              <section className="panel">
                <header className="panel__header">
                  <div>
                    <p className="panel__eyebrow">{t("workspace.panel.activity")}</p>
                    <h2 className="panel__title">{t("workspace.panel.activitySubtitle")}</h2>
                  </div>
                </header>
                <div className="panel__body">
                  <div className="activity-list">
                    {state.activity.map((item) => (
                      <article className="activity-row" key={item.id}>
                        <strong>{item.title}</strong>
                        <span>{formatTimestamp(item.timestamp)}</span>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            <section className="panel panel--compact">
              <header className="panel__header">
                <div>
                  <p className="panel__eyebrow">{t("workspace.panel.extensions")}</p>
                  <h2 className="panel__title">{t("workspace.panel.extensionsSubtitle")}</h2>
                </div>
              </header>
              <div className="panel__body">
                <div className="extension-list">
                  {state.extensions.map((extension) => (
                    <article className="extension-row" key={extension.id}>
                      <strong>{extension.title}</strong>
                      <p>{extension.kind}</p>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </aside>
        ) : null}
      </div>

      <footer className="workspace-footer">
        <div className="button-row">
          <button className="ghost-button" onClick={() => void controller.updateRightPanel("files")} type="button">
            {t("workspace.action.files")}
          </button>
          <button className="ghost-button" onClick={() => void controller.updateRightPanel("snippets")} type="button">
            {t("workspace.action.snippets")}
          </button>
          <button className="ghost-button" onClick={() => void controller.updateRightPanel("activity")} type="button">
            {t("workspace.action.activity")}
          </button>
        </div>
        <div className="button-row">
          <button className="ghost-button" onClick={() => void controller.resetSettings()} type="button">
            {t("workspace.action.resetSettings")}
          </button>
          <span>
            {t("workspace.currentTheme", {
              theme: t(`workspace.theme.${state.settings.terminal.theme}`),
            })}
          </span>
        </div>
      </footer>
    </div>
  );
}
