// 上端のツールバー。ボタンは各機能のタスクで追加する(SPEC 6章)。

import { type Mode, uiStore, useUi } from "../../store";
import "./Toolbar.css";

const MODES: { mode: Mode; label: string; title: string }[] = [
  { mode: "select", label: "選択", title: "選択モード" },
  { mode: "connect", label: "接続", title: "接続モード(C)" },
];

export function Toolbar() {
  const current = useUi((s) => s.mode);
  const view = useUi((s) => s.view);
  return (
    <header className="toolbar">
      <span className="toolbar-title">Constella</span>
      <div className="toolbar-group" role="group" aria-label="モード">
        {MODES.map(({ mode, label, title }) => (
          <button
            key={mode}
            type="button"
            className="toolbar-button"
            aria-pressed={current === mode}
            title={title}
            onClick={() => uiStore.getState().setMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="toolbar-spacer" />
      <div className="toolbar-group" role="group" aria-label="表示">
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={view.showIfLabels}
          title="リンク両端の IF 名を表示する"
          onClick={() => uiStore.getState().setView({ showIfLabels: !view.showIfLabels })}
        >
          IF 名
        </button>
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={view.longIfNames}
          disabled={!view.showIfLabels}
          title="IF 名を長い形(GigabitEthernet0/1)で表示する"
          onClick={() => uiStore.getState().setView({ longIfNames: !view.longIfNames })}
        >
          長い名前
        </button>
      </div>
    </header>
  );
}
