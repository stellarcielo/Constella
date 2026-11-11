// リンクのインスペクタ: 両端(表示だけ)、両端のトランシーバ、media、label。

import {
  bidiPartner,
  type Endpoint,
  endpointTakesTransceiver,
  endpointTransceiver,
  findTransceiver,
  inferMedia,
  type Link,
  MEDIA,
  type Media,
  portTypeOf,
  resolveLabel,
  setLinkTransceiver,
  type Topology,
  updateLink,
} from "../../core";
import { topologyStore, useTopology } from "../../store";
import { useIfNameFormatter } from "../ifNames";
import { MEDIA_LABELS, PORT_TYPE_LABELS } from "../portTypes";
import { CommitInput, Field } from "./fields";
import { IssueList } from "./IssueList";
import { TransceiverInput } from "./TransceiverInput";

const isMedia = (value: string): value is Media => (MEDIA as readonly string[]).includes(value);

export function LinkInspector({ link }: { link: Link }) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const issues = useTopology((s) => s.issues);
  const show = useIfNameFormatter();
  const edit = topologyStore.getState().edit;
  const linkIssues = issues.filter((i) => i.target.kind === "link" && i.target.id === link.id);

  const endpointText = (ep?: Endpoint) => (ep ? `${ep.device}:${show(ep.iface)}` : "?");
  // トランシーバは、挿せる端(RJ45 などのポートとブリッジは除く)にまとめて入れる(SPEC 7.1)
  const ends = [link.a, link.b].filter(
    (ep): ep is Endpoint => ep !== undefined && endpointTakesTransceiver(topology, ep, catalog),
  );

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
        {ends.length > 0 && (
          <Field label="トランシーバ">
            <TransceiverInput
              {...sharedTransceiver(topology, ends)}
              ports={ends.map((ep) => portTypeOf(topology, ep, catalog))}
              onCommit={(v) => edit((t) => setLinkTransceiver(t, link.id, v, catalog))}
            />
          </Field>
        )}
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

/**
 * 両端にまとめて入れる欄の値。両端が同じ(別名・大文字小文字の違いと、BiDi の U と D の組も同じとみなす)なら
 * 端 a の値を出し、違えば空にして、違うことを薄く出す
 */
function sharedTransceiver(
  t: Topology,
  ends: readonly Endpoint[],
): { value: string; placeholder?: string } {
  const [a, b] = ends.map((ep) => endpointTransceiver(t, ep));
  const specA = findTransceiver(a);
  const specB = findTransceiver(b);
  const same =
    ends.length < 2 ||
    a === b ||
    (specA !== undefined &&
      specB !== undefined &&
      (specA === specB || bidiPartner(specA) === specB));
  return same ? { value: a ?? "" } : { value: "", placeholder: "両端で違います" };
}

/** リンクの端。デバイス名をクリックするとそのデバイスを選択する */
function EndpointField({ label, ep }: { label: string; ep?: Endpoint }) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const show = useIfNameFormatter();
  const device = ep ? topology.devices.get(ep.device) : undefined;
  const type = ep ? portTypeOf(topology, ep, catalog) : undefined;
  const transceiver = ep ? endpointTransceiver(topology, ep) : undefined;
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
          {transceiver && <span className="muted mono">{transceiver}</span>}
        </div>
      ) : (
        <span className="mono">{ep ? `${ep.device}:${show(ep.iface)}` : "?"}</span>
      )}
    </Field>
  );
}
