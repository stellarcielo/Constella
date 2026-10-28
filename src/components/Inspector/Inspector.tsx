// 右側のインスペクタ(SPEC 6章)。選んでいるものに合わせて表示を切り替える。
// 何も選んでいないときは、トポロジ全体のタイトルと説明(meta)を編集できる。

import { type Device, type Link, updateMeta } from "../../core";
import { topologyStore, useTopology } from "../../store";
import { DeviceInspector } from "./DeviceInspector";
import { CommitInput, CommitTextarea, Field } from "./fields";
import { LinkInspector } from "./LinkInspector";
import "./Inspector.css";

export function Inspector() {
  const topology = useTopology((s) => s.topology);
  const selection = useTopology((s) => s.selection);
  const devices = selection.devices
    .map((id) => topology.devices.get(id))
    .filter((d): d is Device => d !== undefined);
  const links = selection.links
    .map((id) => topology.links.find((l) => l.id === id))
    .filter((l): l is Link => l !== undefined);

  let body;
  if (devices.length === 1 && links.length === 0) {
    // ID を変えても開いている IF などの状態が消えないよう、内部の識別子で区別する
    body = <DeviceInspector key={devices[0].uid} device={devices[0]} />;
  } else if (links.length === 1 && devices.length === 0) {
    body = <LinkInspector key={links[0].id} link={links[0]} />;
  } else if (devices.length + links.length > 1) {
    body = <SelectionSummary devices={devices.length} links={links.length} />;
  } else {
    body = <TopologyInspector />;
  }
  return <div className="inspector">{body}</div>;
}

function SelectionSummary({ devices, links }: { devices: number; links: number }) {
  return (
    <>
      <header className="inspector-header">
        <div className="inspector-heading">
          <div className="inspector-title">複数選択</div>
          <div className="inspector-subtitle">
            デバイス {devices} 台、リンク {links} 本を選択中
          </div>
        </div>
      </header>
      <section className="inspector-actions">
        <button
          type="button"
          className="inspector-button danger"
          onClick={() => topologyStore.getState().deleteSelection()}
        >
          選択したものを削除
        </button>
      </section>
    </>
  );
}

function TopologyInspector() {
  const topology = useTopology((s) => s.topology);
  const issues = useTopology((s) => s.issues);
  const edit = topologyStore.getState().edit;
  const errors = issues.filter((i) => i.severity === "error").length;
  return (
    <>
      <header className="inspector-header">
        <div className="inspector-heading">
          <div className="inspector-title">{topology.meta.title || "(無題のトポロジ)"}</div>
          <div className="inspector-subtitle">デバイスかリンクを選ぶと、その内容を編集できます</div>
        </div>
      </header>
      <section className="inspector-section">
        <Field label="タイトル">
          <CommitInput
            label="トポロジのタイトル"
            value={topology.meta.title ?? ""}
            onCommit={(v) => edit((t) => updateMeta(t, { title: v }))}
          />
        </Field>
        <Field label="説明">
          <CommitTextarea
            label="トポロジの説明"
            value={topology.meta.description ?? ""}
            onCommit={(v) => edit((t) => updateMeta(t, { description: v }))}
          />
        </Field>
      </section>
      <section className="inspector-section">
        <dl className="inspector-stats">
          <dt>デバイス</dt>
          <dd>{topology.devices.size} 台</dd>
          <dt>リンク</dt>
          <dd>{topology.links.length} 本</dd>
          <dt>エラー</dt>
          <dd>{errors} 件</dd>
          <dt>警告</dt>
          <dd>{issues.length - errors} 件</dd>
        </dl>
      </section>
    </>
  );
}
