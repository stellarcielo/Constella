// 上端のツールバー。ボタンは各機能のタスクで追加する(SPEC 6章)。

import { fileCommands } from "../../commands";
import {
  currentLayer,
  LAYER_LABELS,
  type Mode,
  topologyStore,
  uiStore,
  useUi,
  VIEW_LAYERS,
} from "../../store";
import "./Toolbar.css";

const FILE_BUTTONS = [
  { label: "新規", title: "新規(⌘N)", run: () => void fileCommands.newFile() },
  { label: "開く", title: "開く(⌘O)", run: () => void fileCommands.open() },
  { label: "保存", title: "保存(⌘S)", run: () => void fileCommands.save() },
];

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
      <div className="toolbar-group" role="group" aria-label="ファイル">
        {FILE_BUTTONS.map(({ label, title, run }) => (
          <button key={label} type="button" className="toolbar-button" title={title} onClick={run}>
            {label}
          </button>
        ))}
      </div>
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
      <div className="toolbar-group" role="group" aria-label="レイアウト">
        <button
          type="button"
          className="toolbar-button"
          title="すべてのデバイスを並べ直す(⌘Z で戻せます)"
          onClick={() =>
            void topologyStore
              .getState()
              .autoArrange()
              .then(() => uiStore.getState().requestView({}))
          }
        >
          自動整列
        </button>
      </div>
      <span className="toolbar-spacer" />
      <div className="toolbar-group" role="group" aria-label="YAML">
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={view.showYaml}
          title="YAML エディタを表示する"
          onClick={() => uiStore.getState().setView({ showYaml: !view.showYaml })}
        >
          YAML
        </button>
      </div>
      <div className="toolbar-group" role="group" aria-label="表示レイヤー">
        {VIEW_LAYERS.map((layer, i) => (
          <button
            key={layer}
            type="button"
            className="toolbar-button"
            aria-pressed={currentLayer(view) === layer}
            title={`${LAYER_LABELS[layer].title}(⌘${i})`}
            onClick={() => uiStore.getState().setLayer(layer)}
          >
            {LAYER_LABELS[layer].short}
          </button>
        ))}
      </div>
      <div className="toolbar-group" role="group" aria-label="表示">
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={view.showGroups}
          title="グループ(拠点・ラック・VLAN など)の枠を表示する"
          onClick={() => uiStore.getState().setView({ showGroups: !view.showGroups })}
        >
          グループ
        </button>
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
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={view.showIp}
          title="IF 名ラベルの下に IP アドレスを表示する"
          onClick={() => uiStore.getState().setView({ showIp: !view.showIp })}
        >
          IP
        </button>
        <button
          type="button"
          className="toolbar-button"
          aria-pressed={view.showVlan}
          title="IF 名ラベルの下に VLAN(access は VLAN 番号、trunk は通す VLAN)を表示する"
          onClick={() => uiStore.getState().setView({ showVlan: !view.showVlan })}
        >
          VLAN
        </button>
      </div>
    </header>
  );
}
