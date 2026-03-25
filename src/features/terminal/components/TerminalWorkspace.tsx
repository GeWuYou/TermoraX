import { useState } from "react";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import { StatusBadge } from "../../../shared/components/StatusBadge";
import { Panel } from "../../../shared/components/Panel";
import { t } from "../../../shared/i18n";
import { formatTimestamp } from "../../../shared/lib/time";

interface TerminalWorkspaceProps {
  controller: WorkspaceController;
}

export function TerminalWorkspace({ controller }: TerminalWorkspaceProps) {
  const { state, activeSession } = controller;
  const [commandInput, setCommandInput] = useState("");

  return (
    <Panel
      title={t("terminal.title")}
      subtitle={activeSession ? activeSession.title : t("files.noSession")}
      actions={
        <div className="button-row">
          <button className="ghost-button" onClick={() => void controller.toggleTheme()} type="button">
            {t("terminal.toggleTheme")}
          </button>
          <button className="ghost-button" onClick={() => void controller.toggleRightPanel()} type="button">
            {t("terminal.togglePanel")}
          </button>
        </div>
      }
      className="terminal-panel"
    >
      <div className="terminal-shell">
        <div className="tab-strip">
          {state.sessions.map((session) => (
            <button
              key={session.id}
              className={`tab-chip ${state.activeSessionId === session.id ? "is-active" : ""}`}
              onClick={() => controller.selectSession(session.id)}
              type="button"
            >
              <span>{session.title}</span>
              <StatusBadge status={session.status} />
              <span
                className="tab-chip__close"
                onClick={(event) => {
                  event.stopPropagation();
                  void controller.closeSession(session.id);
                }}
                role="button"
                tabIndex={0}
              >
                ×
              </span>
            </button>
          ))}
          {state.sessions.length === 0 ? <div className="tab-strip__empty">{t("terminal.openHint")}</div> : null}
        </div>

        <div className="terminal-view">
          {activeSession ? (
            <>
              <div className="terminal-meta">
                <span>{activeSession.currentPath}</span>
                <span>{t("terminal.lastUpdate", { time: formatTimestamp(activeSession.updatedAt) })}</span>
              </div>
              <pre
                className={`terminal-output terminal-output--${state.settings.terminal.theme}`}
                style={{
                  fontFamily: state.settings.terminal.fontFamily,
                  fontSize: `${state.settings.terminal.fontSize}px`,
                  lineHeight: state.settings.terminal.lineHeight,
                }}
              >
                {activeSession.lastOutput}
              </pre>
              <form
                className="terminal-input-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void controller.sendSessionInput(activeSession.id, commandInput);
                  setCommandInput("");
                }}
              >
                <input
                  onChange={(event) => setCommandInput(event.target.value)}
                  placeholder={t("terminal.commandPlaceholder")}
                  value={commandInput}
                />
                <button className="primary-button" type="submit">
                  {t("terminal.send")}
                </button>
              </form>
            </>
          ) : (
            <div className="empty-stage">
              <h3>{t("terminal.emptyTitle")}</h3>
              <p>{t("terminal.emptyBody")}</p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
