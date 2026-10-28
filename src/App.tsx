import { Canvas } from "./components/Canvas/Canvas";
import { Inspector } from "./components/Inspector/Inspector";
import { Palette } from "./components/Palette/Palette";
import { useShortcuts } from "./components/shortcuts";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { Toolbar } from "./components/Toolbar/Toolbar";
import "./App.css";

function App() {
  useShortcuts();
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
    </div>
  );
}

export default App;
