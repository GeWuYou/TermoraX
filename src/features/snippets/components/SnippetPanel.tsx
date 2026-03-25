import { useState } from "react";
import type { CommandSnippet } from "../../../entities/domain";
import type { WorkspaceController } from "../../../app/useWorkspaceApp";
import { Panel } from "../../../shared/components/Panel";
import { t } from "../../../shared/i18n";

interface SnippetPanelProps {
  controller: WorkspaceController;
}

const emptySnippet = {
  name: "",
  command: "",
  description: "",
  group: "默认分组",
  tags: "",
};

export function SnippetPanel({ controller }: SnippetPanelProps) {
  const [draft, setDraft] = useState(emptySnippet);
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);

  function editSnippet(snippet: CommandSnippet) {
    setEditingSnippetId(snippet.id);
    setDraft({
      name: snippet.name,
      command: snippet.command,
      description: snippet.description,
      group: snippet.group,
      tags: snippet.tags.join(", "),
    });
  }

  return (
    <Panel title={t("snippets.title")} subtitle={t("snippets.subtitle", { count: controller.state.snippets.length })}>
      <div className="snippet-list">
        {controller.state.snippets.map((snippet) => (
          <div className="snippet-card" key={snippet.id}>
            <div className="snippet-card__header">
              <div>
                <strong>{snippet.name}</strong>
                <p>{snippet.group}</p>
              </div>
              <div className="button-row">
                <button className="ghost-button" onClick={() => editSnippet(snippet)} type="button">
                  {t("snippets.edit")}
                </button>
                <button className="ghost-button" onClick={() => void controller.runSnippetOnActiveSession(snippet.id)} type="button">
                  {t("snippets.run")}
                </button>
                <button className="danger-button" onClick={() => void controller.deleteSnippet(snippet.id)} type="button">
                  {t("snippets.delete")}
                </button>
              </div>
            </div>
            <code>{snippet.command}</code>
            <span>{snippet.description}</span>
          </div>
        ))}
      </div>

      <form
        className="stack-form stack-form--spaced"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.saveSnippet({
            id: editingSnippetId ?? undefined,
            name: draft.name,
            command: draft.command,
            description: draft.description,
            group: draft.group,
            tags: draft.tags
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          });
          setEditingSnippetId(null);
          setDraft(emptySnippet);
        }}
      >
        <label>
          <span>{t("snippets.field.name")}</span>
          <input
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder="磁盘占用检查"
            value={draft.name}
          />
        </label>
        <label>
          <span>{t("snippets.field.command")}</span>
          <textarea
            onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))}
            placeholder="df -h"
            rows={3}
            value={draft.command}
          />
        </label>
        <label>
          <span>{t("snippets.field.description")}</span>
          <input
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            placeholder="快速查看文件系统占用"
            value={draft.description}
          />
        </label>
        <div className="form-grid">
          <label>
            <span>{t("snippets.field.group")}</span>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, group: event.target.value }))}
              placeholder="诊断"
              value={draft.group}
            />
          </label>
          <label>
            <span>{t("snippets.field.tags")}</span>
            <input
              onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
              placeholder="磁盘, 运行时"
              value={draft.tags}
            />
          </label>
        </div>
        <button className="primary-button" type="submit">
          {t("snippets.save")}
        </button>
      </form>
    </Panel>
  );
}
