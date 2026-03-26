import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionAuthType, ConnectionProfile } from "../../../entities/domain";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import { Panel } from "../../../shared/components/Panel";
import { t } from "../../../shared/i18n";
import { detectDuplicateConnections, groupConnections } from "../model/connection-utils";

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
  password: "",
  privateKeyPath: "",
  privateKeyPassphrase: "",
};

function draftFromProfile(profile: ConnectionProfile) {
  return {
    name: profile.name,
    host: profile.host,
    port: String(profile.port),
    username: profile.username,
    group: profile.group,
    authType: profile.authType,
    note: profile.note,
    tags: profile.tags.join(", "),
    password: profile.password ?? "",
    privateKeyPath: profile.privateKeyPath ?? "",
    privateKeyPassphrase: profile.privateKeyPassphrase ?? "",
  };
}

export function ConnectionSidebar({ controller }: ConnectionSidebarProps) {
  const { state, selectedConnection } = controller;
  const [draft, setDraft] = useState(emptyDraft);
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const groupedConnections = useMemo(
    () => groupConnections(state.connections, searchTerm),
    [state.connections, searchTerm],
  );
  const duplicateEntries = detectDuplicateConnections(state.connections);
  const pendingHostVerification =
    selectedConnection && state.pendingHostVerification?.connectionId === selectedConnection.id
      ? state.pendingHostVerification
      : null;
  const lastHostInspection =
    pendingHostVerification && state.lastHostInspection?.connectionId === pendingHostVerification.connectionId
      ? state.lastHostInspection
      : null;

  useEffect(() => {
    if (!selectedConnection) {
      return;
    }

    // The first bootstrap snapshot selects a connection automatically, so the editor
    // needs to hydrate from that selection without waiting for a manual click.
    setDraft(draftFromProfile(selectedConnection));
  }, [selectedConnection?.id]);

  function buildDraftProfile(): Partial<ConnectionProfile> {
    return {
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
      password: draft.password,
      privateKeyPath: draft.privateKeyPath,
      privateKeyPassphrase: draft.privateKeyPassphrase,
    };
  }

  // Keep group collapse local to the panel so filtering does not mutate global app state.
  function toggleGroup(group: string) {
    setCollapsedGroups((current) => ({
      ...current,
      [group]: !current[group],
    }));
  }

  function loadProfile(profile: ConnectionProfile) {
    controller.selectConnection(profile.id);
    controller.clearConnectionFeedback();
    setConfirmDeleteId(null);
    setDraft(draftFromProfile(profile));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await controller.saveConnectionProfile(buildDraftProfile());
  }

  async function handleDeleteConfirm() {
    if (!selectedConnection) {
      return;
    }

    await controller.deleteConnectionProfile(selectedConnection.id);
    setConfirmDeleteId(null);
    setDraft(emptyDraft);
  }

  async function handleExport() {
    const result = await controller.exportConnectionProfiles();

    if (!result) {
      return;
    }

    // Blob download works in both browser fallback mode and the Tauri webview.
    const url = URL.createObjectURL(new Blob([result.content], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `termorax-connections-${result.exportedAt}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const content = await file.text();
    await controller.importConnectionProfilesFromJson(content);
    event.target.value = "";
  }

  return (
    <div className="sidebar-stack">
      <Panel
        title={t("connections.title")}
        subtitle={t("connections.subtitle", { count: state.connections.length })}
        actions={
          <button
            className="ghost-button"
            onClick={() => {
              controller.clearConnectionFeedback();
              setDraft(emptyDraft);
              setConfirmDeleteId(null);
            }}
            type="button"
          >
            {t("connections.new")}
          </button>
        }
      >
        <input hidden accept="application/json" onChange={handleImport} ref={fileInputRef} type="file" />

        <div className="connection-panel-tools">
          <div className="connection-search">
            <input
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
              placeholder={t("connections.searchPlaceholder")}
              value={searchTerm}
            />
            <button className="ghost-button" onClick={() => setSearchTerm("")} type="button">
              {t("connections.clear")}
            </button>
          </div>

          <div className="connection-panel-actions">
            <button className="ghost-button" onClick={() => fileInputRef.current?.click()} type="button">
              {t("connections.import")}
            </button>
            <button className="ghost-button" onClick={() => void handleExport()} type="button">
              {t("connections.export")}
            </button>
            <button className="ghost-button" onClick={() => void controller.testConnectionProfile(buildDraftProfile())} type="button">
              {t("connections.test")}
            </button>
          </div>
        </div>

        {state.connectionStatusMessage ? <div className="info-banner">{state.connectionStatusMessage}</div> : null}
        {state.connectionDuplicateWarning ? (
          <div className="warning-banner">{state.connectionDuplicateWarning.message}</div>
        ) : null}

        {duplicateEntries.length ? (
          <div className="warning-banner">
            <p>发现重复连接配置，请检查 host:port@user：</p>
            <ul>
              {duplicateEntries.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {groupedConnections.length === 0 ? (
          <div className="empty-panel">
            <p>{t("connections.searchEmpty")}</p>
          </div>
        ) : (
          groupedConnections.map(({ group, entries }) => {
            const isCollapsed = collapsedGroups[group];

            return (
              <section className="connection-group" key={group}>
                <header className="connection-group__header" onClick={() => toggleGroup(group)}>
                  <strong>{group}</strong>
                  <div className="button-row">
                    <span>{entries.length} 个</span>
                    <button
                      className="ghost-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleGroup(group);
                      }}
                      type="button"
                    >
                      {isCollapsed ? "展开" : "折叠"}
                    </button>
                  </div>
                </header>

                {!isCollapsed ? (
                  <div className="connection-list">
                    {entries.map((profile) => (
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
                ) : null}
              </section>
            );
          })
        )}
      </Panel>

      <Panel
        title={t("connections.editorTitle")}
        subtitle={
          selectedConnection
            ? t("connections.editorEditing", { name: selectedConnection.name })
            : t("connections.editorCreate")
        }
      >
        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            <span>{t("connections.field.name")}</span>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="生产应用-01"
              value={draft.name}
            />
            {state.connectionValidationErrors.name ? (
              <span className="field-error">{state.connectionValidationErrors.name}</span>
            ) : null}
          </label>

          <label>
            <span>{t("connections.field.host")}</span>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))}
              placeholder="10.10.0.12"
              value={draft.host}
            />
            {state.connectionValidationErrors.host ? (
              <span className="field-error">{state.connectionValidationErrors.host}</span>
            ) : null}
          </label>

          <div className="form-grid">
            <label>
              <span>{t("connections.field.port")}</span>
              <input
                onChange={(event) => setDraft((current) => ({ ...current, port: event.target.value }))}
                placeholder="22"
                value={draft.port}
              />
              {state.connectionValidationErrors.port ? (
                <span className="field-error">{state.connectionValidationErrors.port}</span>
              ) : null}
            </label>

            <label>
              <span>{t("connections.field.user")}</span>
              <input
                onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
                placeholder="deploy"
                value={draft.username}
              />
              {state.connectionValidationErrors.username ? (
                <span className="field-error">{state.connectionValidationErrors.username}</span>
              ) : null}
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

          {draft.authType === "password" ? (
            <label>
              <span>{t("connections.field.password")}</span>
              <input
                type="password"
                onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
                placeholder={t("connections.placeholder.password")}
                value={draft.password}
              />
              {state.connectionValidationErrors.password ? (
                <span className="field-error">{state.connectionValidationErrors.password}</span>
              ) : null}
            </label>
          ) : (
            <>
              <label>
                <span>{t("connections.field.privateKeyPath")}</span>
                <input
                  onChange={(event) => setDraft((current) => ({ ...current, privateKeyPath: event.target.value }))}
                  placeholder={t("connections.placeholder.privateKeyPath")}
                  value={draft.privateKeyPath}
                />
                {state.connectionValidationErrors.privateKeyPath ? (
                  <span className="field-error">{state.connectionValidationErrors.privateKeyPath}</span>
                ) : null}
              </label>
              <label>
                <span>{t("connections.field.privateKeyPassphrase")}</span>
                <input
                  type="password"
                  onChange={(event) => setDraft((current) => ({ ...current, privateKeyPassphrase: event.target.value }))}
                  placeholder={t("connections.placeholder.privateKeyPassphrase")}
                  value={draft.privateKeyPassphrase}
                />
              </label>
            </>
          )}

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
            {selectedConnection ? (
              <button className="danger-button" onClick={() => setConfirmDeleteId(selectedConnection.id)} type="button">
                {t("connections.delete")}
              </button>
            ) : null}
          </div>
          {pendingHostVerification ? (
            <div className="host-verification-panel">
              <strong>{t("connections.hostInspectionTitle")}</strong>
              <p>
                {t("connections.hostInspectionMessage", {
                  host: pendingHostVerification.host,
                  port: pendingHostVerification.port,
                  algorithm: pendingHostVerification.algorithm,
                })}
              </p>
              <p className="host-verification-panel__fingerprint">
                {t("connections.hostInspectionFingerprint", { fingerprint: pendingHostVerification.fingerprint })}
              </p>
              {lastHostInspection?.trustedFingerprint ? (
                <div className="warning-banner">
                  {t("connections.hostInspectionTrustedFingerprint", {
                    fingerprint: lastHostInspection.trustedFingerprint,
                  })}
                </div>
              ) : null}
              {lastHostInspection?.trustStatus === "mismatch" ? (
                <div className="warning-banner">{t("connections.hostInspectionMismatch")}</div>
              ) : null}
              <p className="info-banner">{t("connections.hostInspectionWarning")}</p>
              <div className="button-row">
                <button
                  className="primary-button"
                  onClick={() => void controller.trustPendingHost()}
                  type="button"
                >
                  {t("connections.hostInspectionTrust")}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => controller.dismissPendingHostVerification()}
                  type="button"
                >
                  {t("connections.hostInspectionCancel")}
                </button>
              </div>
            </div>
          ) : null}
        </form>

        {confirmDeleteId ? (
          <div className="danger-zone">
            <strong>{t("connections.deleteConfirmTitle")}</strong>
            <p>{t("connections.deleteConfirmBody")}</p>
            <div className="button-row">
              <button className="danger-button" onClick={() => void handleDeleteConfirm()} type="button">
                {t("connections.deleteConfirmAction")}
              </button>
              <button className="ghost-button" onClick={() => setConfirmDeleteId(null)} type="button">
                {t("connections.deleteCancel")}
              </button>
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
