import { useState } from "react";
import type { ConnectionAuthType, ConnectionProfile } from "../../../entities/domain";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import { Panel } from "../../../shared/components/Panel";
import { t } from "../../../shared/i18n";

interface ConnectionSidebarProps {
  controller: WorkspaceController;
}

const emptyDraft = {
  name: "",
  host: "",
  port: "22",
  username: "",
  group: "默认分组",
  authType: "password" as ConnectionAuthType,
  note: "",
  tags: "",
};

export function ConnectionSidebar({ controller }: ConnectionSidebarProps) {
  const { state, selectedConnection } = controller;
  const [draft, setDraft] = useState(emptyDraft);

  function loadProfile(profile: ConnectionProfile) {
    controller.selectConnection(profile.id);
    setDraft({
      name: profile.name,
      host: profile.host,
      port: String(profile.port),
      username: profile.username,
      group: profile.group,
      authType: profile.authType,
      note: profile.note,
      tags: profile.tags.join(", "),
    });
  }

  return (
    <div className="sidebar-stack">
      <Panel
        title={t("connections.title")}
        subtitle={t("connections.subtitle", { count: state.connections.length })}
        actions={
          <button className="ghost-button" onClick={() => setDraft(emptyDraft)} type="button">
            {t("connections.new")}
          </button>
        }
      >
        <div className="connection-list">
          {state.connections.map((profile) => (
            <button
              key={profile.id}
              className={`connection-card ${state.selectedConnectionId === profile.id ? "is-active" : ""}`}
              onClick={() => loadProfile(profile)}
              type="button"
            >
              <span className="connection-card__title">{profile.name}</span>
              <span className="connection-card__meta">
                {profile.group} · {profile.username}@{profile.host}
              </span>
              <span className="connection-card__tags">{profile.tags.join("  ")}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        title={t("connections.editorTitle")}
        subtitle={
          selectedConnection
            ? t("connections.editorEditing", { name: selectedConnection.name })
            : t("connections.editorCreate")
        }
        actions={
          selectedConnection ? (
            <button
              className="danger-button"
              onClick={() => void controller.deleteConnectionProfile(selectedConnection.id)}
              type="button"
            >
              {t("connections.delete")}
            </button>
          ) : null
        }
      >
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.saveConnectionProfile({
              id: selectedConnection?.id,
              name: draft.name,
              host: draft.host,
              port: Number(draft.port || 22),
              username: draft.username,
              group: draft.group,
              authType: draft.authType,
              note: draft.note,
              tags: draft.tags
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            });
            setDraft(emptyDraft);
          }}
        >
          <label>
            <span>{t("connections.field.name")}</span>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="生产应用-01"
              value={draft.name}
            />
          </label>
          <label>
            <span>{t("connections.field.host")}</span>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))}
              placeholder="10.10.0.12"
              value={draft.host}
            />
          </label>
          <div className="form-grid">
            <label>
              <span>{t("connections.field.port")}</span>
              <input
                onChange={(event) => setDraft((current) => ({ ...current, port: event.target.value }))}
                placeholder="22"
                value={draft.port}
              />
            </label>
            <label>
              <span>{t("connections.field.user")}</span>
              <input
                onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
                placeholder="deploy"
                value={draft.username}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              <span>{t("connections.field.group")}</span>
              <input
                onChange={(event) => setDraft((current) => ({ ...current, group: event.target.value }))}
                placeholder="生产环境"
                value={draft.group}
              />
            </label>
            <label>
              <span>{t("connections.field.auth")}</span>
              <select
                onChange={(event) =>
                  setDraft((current) => ({ ...current, authType: event.target.value as ConnectionAuthType }))
                }
                value={draft.authType}
              >
                <option value="password">{t("connections.auth.password")}</option>
                <option value="privateKey">{t("connections.auth.privateKey")}</option>
              </select>
            </label>
          </div>
          <label>
            <span>{t("connections.field.tags")}</span>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
              placeholder="api, cn-sha"
              value={draft.tags}
            />
          </label>
          <label>
            <span>{t("connections.field.note")}</span>
            <textarea
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
              placeholder="用途、网络说明、注意事项"
              rows={3}
              value={draft.note}
            />
          </label>
          <div className="button-row">
            <button className="primary-button" type="submit">
              {t("connections.save")}
            </button>
            {selectedConnection ? (
              <button
                className="ghost-button"
                onClick={() => void controller.openSession(selectedConnection.id)}
                type="button"
              >
                {t("connections.openSession")}
              </button>
            ) : null}
          </div>
        </form>
      </Panel>
    </div>
  );
}
