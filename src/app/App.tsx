import { WorkspaceShell } from "../features/workspace/components/WorkspaceShell";
import { useWorkspaceApp } from "./useWorkspaceApp";
import { t } from "../shared/i18n";

function App() {
  const controller = useWorkspaceApp();

  if (controller.state.isLoading) {
    return (
      <div className="boot-screen">
        <p className="boot-screen__eyebrow">{t("app.name")}</p>
        <h1>{t("app.boot")}</h1>
      </div>
    );
  }

  return <WorkspaceShell controller={controller} />;
}

export default App;
