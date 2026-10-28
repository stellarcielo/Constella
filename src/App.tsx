import { Canvas } from "./components/Canvas/Canvas";
import { DialogHost } from "./components/Dialog/DialogHost";
import { Inspector } from "./components/Inspector/Inspector";
import { Palette } from "./components/Palette/Palette";
import { ProblemsPanel } from "./components/ProblemsPanel/ProblemsPanel";
import { useShortcuts } from "./components/shortcuts";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { Toolbar } from "./components/Toolbar/Toolbar";
import { YamlEditor } from "./components/YamlEditor/YamlEditor";
import { useDocumentShell } from "./components/useDocumentShell";
import { useUi } from "./store";
import "./App.css";

function App() {
  useShortcuts();
  useDocumentShell();
  const problemsOpen = useUi((s) => s.problemsOpen);
  const showYaml = useUi((s) => s.view.showYaml);
  return (
    <div className="app">
      <Toolbar />
      <div className={`app-main${showYaml ? " with-yaml" : ""}`}>
        <Palette />
        <Canvas />
        {/* 上段にインスペクタ、下段に YAML エディタ(SPEC 6章)。エディタは置き場所に依存しない部品 */}
        <aside className="app-side">
          <div className="app-side-inspector">
            <Inspector />
          </div>
          {showYaml && (
            <div className="app-side-yaml">
              <YamlEditor />
            </div>
          )}
        </aside>
      </div>
      {problemsOpen && <ProblemsPanel />}
      <StatusBar />
      <DialogHost />
    </div>
  );
}

export default App;
