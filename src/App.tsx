import { Canvas } from "./components/Canvas/Canvas";
import { DialogHost } from "./components/Dialog/DialogHost";
import { Inspector } from "./components/Inspector/Inspector";
import { Palette } from "./components/Palette/Palette";
import { useShortcuts } from "./components/shortcuts";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { Toolbar } from "./components/Toolbar/Toolbar";
import { useDocumentShell } from "./components/useDocumentShell";
import "./App.css";

function App() {
  useShortcuts();
  useDocumentShell();
  return (
    <div className="app">
      <Toolbar />
      <div className="app-main">
        <Palette />
        <Canvas />
        {/* YAML エディタ(下段)はフェーズ2で入れる */}
        <aside className="app-side">
          <Inspector />
        </aside>
      </div>
      <StatusBar />
      <DialogHost />
    </div>
  );
}

export default App;
