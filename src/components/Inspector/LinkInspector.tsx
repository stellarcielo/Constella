// リンクのインスペクタ: 両端(表示だけ)、media、label。

import {
  type Endpoint,
  inferMedia,
  type Link,
  MEDIA,
  type Media,
  portTypeOf,
  resolveLabel,
  updateLink,
} from "../../core";
import { topologyStore, useTopology } from "../../store";
import { useIfNameFormatter } from "../ifNames";
import { MEDIA_LABELS, PORT_TYPE_LABELS } from "../portTypes";
import { CommitInput, Field } from "./fields";
import { IssueList } from "./IssueList";

const isMedia = (value: string): value is Media => (MEDIA as readonly string[]).includes(value);

export function LinkInspector({ link }: { link: Link }) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const issues = useTopology((s) => s.issues);
  const show = useIfNameFormatter();
  const edit = topologyStore.getState().edit;
  const linkIssues = issues.filter((i) => i.target.kind === "link" && i.target.id === link.id);

  const endpointText = (ep?: Endpoint) => (ep ? `${ep.device}:${show(ep.iface)}` : "?");

  return (
    <>
      <header className="inspector-header">
        <div className="inspector-heading">
          <div className="inspector-title">リンク</div>
          <div className="inspector-subtitle mono">
            {endpointText(link.a)} ↔ {endpointText(link.b)}
          </div>
        </div>
      </header>

      <IssueList issues={linkIssues} />

      <section className="inspector-section">
        <EndpointField label="端 A" ep={link.a} />
        <EndpointField label="端 B" ep={link.b} />
      </section>

      <section className="inspector-section">
        <Field label="種類">
          <select
            className="field-input"
            aria-label="ケーブルの種類(media)"
            value={link.media ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              e.currentTarget.blur();
              edit((t) => updateLink(t, link.id, { media: isMedia(value) ? value : undefined }));
            }}
          >
            <option value="">自動({MEDIA_LABELS[inferMedia(link, topology, catalog)]})</option>
            {MEDIA.map((m) => (
              <option key={m} value={m}>
                {MEDIA_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ラベル">
          <CommitInput
            label="リンクのラベル"
            value={link.label ?? ""}
            onCommit={(v) => edit((t) => updateLink(t, link.id, { label: v }))}
          />
        </Field>
      </section>

      <section className="inspector-actions">
        <button
          type="button"
          className="inspector-button danger"
          onClick={() => topologyStore.getState().deleteElements({ links: [link.id] })}
        >
          このリンクを削除
        </button>
      </section>
    </>
  );
}

/** リンクの端。デバイス名をクリックするとそのデバイスを選択する */
function EndpointField({ label, ep }: { label: string; ep?: Endpoint }) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const show = useIfNameFormatter();
  const device = ep ? topology.devices.get(ep.device) : undefined;
  const type = ep ? portTypeOf(topology, ep, catalog) : undefined;
  return (
    <Field label={label}>
      {ep && device ? (
        <div className="endpoint">
          <button
            type="button"
            className="link-button"
            title="このデバイスを選択"
            onClick={() =>
              topologyStore.getState().setSelection({ devices: [ep.device], links: [] })
            }
          >
            {resolveLabel(device)}
          </button>
          <span className="mono">{show(ep.iface)}</span>
          {type && <span className="muted">{PORT_TYPE_LABELS[type]}</span>}
        </div>
      ) : (
        <span className="mono">{ep ? `${ep.device}:${show(ep.iface)}` : "?"}</span>
      )}
    </Field>
  );
}
