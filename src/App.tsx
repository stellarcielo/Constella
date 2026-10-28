import { Canvas } from "./components/Canvas/Canvas";
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
        {/* インスペクタ(上)と YAML エディタ(下)は後のタスクで入れる */}
        <aside className="app-side" />
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
