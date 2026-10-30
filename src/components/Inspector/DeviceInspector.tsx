// デバイスのインスペクタ: ID・ラベル・モデル・role・ゲスト・ブリッジ・IF 一覧(SPEC 7.1・4.6)。

import { useState } from "react";
import {
  bridgeKey,
  bridgeLinks,
  bridgesOf,
  changeHost,
  changeModel,
  checkDeviceId,
  type Device,
  type Endpoint,
  findModel,
  GUEST_KINDS,
  type GuestKind,
  hostCandidates,
  type HostChangeImpact,
  hostChangeImpact,
  type Link,
  type ModelChangeImpact,
  modelChangeImpact,
  resolveGuest,
  resolveLabel,
  resolveRole,
  type Role,
  ROLES,
  setDeviceGuest,
  setDeviceLabel,
  setDeviceRole,
  setDeviceVmid,
  type Topology,
  VMID_MAX,
  VMID_MIN,
} from "../../core";
import { RoleIcon } from "../../icons/RoleIcon";
import { GUEST_LABELS, ROLE_LABELS, ROLE_ORDER } from "../../icons/roles";
import { topologyStore, useTopology } from "../../store";
import { ConfirmDialog } from "../Dialog/ConfirmDialog";
import { useIfNameFormatter } from "../ifNames";
import { modelSections } from "../modelSections";
import { CommitInput, Field } from "./fields";
import { InterfaceList } from "./InterfaceList";
import { IssueList } from "./IssueList";

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);
const isGuestKind = (value: string): value is GuestKind =>
  (GUEST_KINDS as readonly string[]).includes(value);

const vmidError = (value: string): string | undefined =>
  value === "" || (/^\d+$/.test(value) && Number(value) >= VMID_MIN && Number(value) <= VMID_MAX)
    ? undefined
    : `${VMID_MIN}〜${VMID_MAX} の整数を入力してください`;

/** ホストの選択肢での名前(ラベルがあれば添える) */
const hostName = (t: Topology, id: string) => {
  const label = t.devices.get(id)?.label;
  return label && label !== id ? `${id}(${label})` : id;
};

type ModelDecision = "keep" | "remove";

export function DeviceInspector({ device }: { device: Device }) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const issues = useTopology((s) => s.issues);
  const show = useIfNameFormatter();
  const [pending, setPending] = useState<{ modelId: string; impact: ModelChangeImpact } | null>(
    null,
  );

  const id = device.id;
  const model = findModel(device, catalog);
  const role = resolveRole(device, catalog);
  const guest = resolveGuest(device, catalog);
  const edit = topologyStore.getState().edit;
  // デバイスそのものと IF の問題に加え、このデバイス側の端を指すリンクの問題(モデルに無い IF など)も出す
  const deviceIssues = issues.filter((i) => {
    const target = i.target;
    if (target.kind === "device") return target.id === id;
    if (target.kind === "interface") return target.device === id;
    if (target.kind === "link" && target.end) {
      return topology.links.find((l) => l.id === target.id)?.[target.end]?.device === id;
    }
    return false;
  });

  const applyModel = (modelId: string | undefined, removeLostPorts: boolean) =>
    edit((t) => changeModel(t, id, modelId, catalog, { removeLostPorts }));

  const onModelChange = (value: string) => {
    const modelId = value === "" ? undefined : value;
    const impact = modelChangeImpact(topology, id, modelId, catalog);
    if (modelId !== undefined && (impact.links.length > 0 || impact.interfaces.length > 0)) {
      setPending({ modelId, impact });
    } else {
      applyModel(modelId, false);
    }
  };

  const unknownModel = device.model !== undefined && !model;

  /** このデバイス側を先にして「Gi0/1 ↔ sw1:Gi0/2」の形にする */
  const describeLink = (link: Link) => {
    const [mine, other] = (link.a?.device === id ? [link.a, link.b] : [link.b, link.a]) as [
      Endpoint | undefined,
      Endpoint | undefined,
    ];
    return `${mine ? show(mine.iface) : "?"} ↔ ${other ? `${other.device}:${show(other.iface)}` : "?"}`;
  };

  return (
    <>
      <header className="inspector-header">
        <span className={`inspector-icon role-icon role-${role}`}>
          <RoleIcon role={role} size={26} />
        </span>
        <div className="inspector-heading">
          <div className="inspector-title">{resolveLabel(device)}</div>
          <div className="inspector-subtitle">
            {model?.name ?? device.model ?? "モデルなし(フレキシブル)"}
          </div>
        </div>
      </header>

      <IssueList issues={deviceIssues} />

      <section className="inspector-section">
        <Field label="ID">
          <CommitInput
            label="デバイスID"
            monospace
            value={id}
            validate={(v) => checkDeviceId(topology, v, id)}
            onCommit={(v) => topologyStore.getState().renameDevice(id, v)}
          />
        </Field>
        <Field label="ラベル">
          <CommitInput
            label="ラベル"
            value={device.label ?? ""}
            placeholder={id}
            onCommit={(v) => edit((t) => setDeviceLabel(t, id, v))}
          />
        </Field>
        <Field label="モデル">
          <select
            className="field-input"
            aria-label="モデル"
            value={device.model ?? ""}
            onChange={(e) => {
              e.currentTarget.blur();
              onModelChange(e.target.value);
            }}
          >
            <option value="">モデルなし(フレキシブル)</option>
            {unknownModel && <option value={device.model}>不明なモデル: {device.model}</option>}
            {modelSections(catalog.values()).map((section) => (
              <optgroup key={section.key} label={section.label}>
                {section.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ?? m.id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="役割">
          <select
            className="field-input"
            aria-label="役割"
            value={device.role ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              e.currentTarget.blur();
              edit((t) => setDeviceRole(t, id, isRole(value) ? value : undefined, catalog));
            }}
          >
            <option value="">
              {model ? `モデルどおり(${ROLE_LABELS[model.role]})` : "未指定(その他)"}
            </option>
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ゲスト">
          <select
            className="field-input"
            aria-label="ゲスト"
            value={device.guest ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              e.currentTarget.blur();
              edit((t) => setDeviceGuest(t, id, isGuestKind(value) ? value : undefined, catalog));
            }}
          >
            <option value="">
              {model?.guest
                ? `モデルどおり(${GUEST_LABELS[model.guest]})`
                : device.host !== undefined
                  ? "未指定(VM)"
                  : "なし(物理的な機器)"}
            </option>
            {GUEST_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {GUEST_LABELS[kind]}
              </option>
            ))}
          </select>
        </Field>
        {guest && <GuestFields device={device} />}
      </section>

      {(role === "hypervisor" || bridgesOf(device).length > 0) && <BridgeList device={device} />}

      <InterfaceList device={device} />

      <section className="inspector-actions">
        <button
          type="button"
          className="inspector-button danger"
          onClick={() => topologyStore.getState().deleteElements({ devices: [id] })}
        >
          このデバイスを削除
        </button>
      </section>

      {pending && (
        <ConfirmDialog<ModelDecision>
          title="モデルを変更しますか?"
          actions={[
            { value: "keep", label: "変更して、そのまま残す" },
            { value: "remove", label: "変更して、削除する", primary: true, danger: true },
          ]}
          onAction={(decision) => {
            applyModel(pending.modelId, decision === "remove");
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        >
          <p>
            「{catalog.get(pending.modelId)?.name ?? pending.modelId}」には、{id}{" "}
            が使っている次のポートがありません。
          </p>
          {pending.impact.links.length > 0 && (
            <>
              <h3>リンク({pending.impact.links.length} 本)</h3>
              <ul>
                {pending.impact.links.map((link) => (
                  <li key={link.id}>{describeLink(link)}</li>
                ))}
              </ul>
            </>
          )}
          {pending.impact.interfaces.length > 0 && (
            <>
              <h3>IF の設定({pending.impact.interfaces.length} 件)</h3>
              <ul>
                {pending.impact.interfaces.map((name) => (
                  <li key={name}>{show(name)}</li>
                ))}
              </ul>
            </>
          )}
          <p className="muted">「そのまま残す」を選ぶと、これらはエラーとして表示されます。</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** ゲストのホストと VMID(SPEC 4.6) */
/** ホストのブリッジの一覧と「ブリッジを追加」(SPEC 4.6・フェーズ4-2 Q1) */
function BridgeList({ device }: { device: Device }) {
  const topology = useTopology((s) => s.topology);
  const bridges = bridgesOf(device);
  const select = (bridge: string) =>
    topologyStore.getState().setSelection({ devices: [bridgeKey(device.id, bridge)], links: [] });
  return (
    <section className="inspector-section">
      <div className="inspector-section-head">
        <h3>ブリッジ</h3>
        <button
          type="button"
          className="inspector-button"
          title="ブリッジ(仮想スイッチ)を足して、ホストの下に置く"
          onClick={() => topologyStore.getState().addBridge(device.id)}
        >
          ＋ ブリッジを追加
        </button>
      </div>
      <ul className="if-list">
        {bridges.map((bridge) => {
          const info = device.interfaces.get(bridge);
          const links = bridgeLinks(topology, device.id, bridge).length;
          return (
            <li key={bridge} className="if-row">
              <div className="if-row-head">
                <button
                  type="button"
                  className="if-row-toggle"
                  title="このブリッジを選択"
                  onClick={() => select(bridge)}
                >
                  <span className="if-name mono">{bridge}</span>
                  {info?.vlanAware && <span className="if-meta">VLAN aware</span>}
                  {info?.members && (
                    <span className="if-desc mono">← {info.members.join(", ")}</span>
                  )}
                </button>
                <span className="if-free">{links > 0 ? `${links} 本` : "空き"}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {bridges.length === 0 && <p className="muted">ブリッジはまだありません</p>}
    </section>
  );
}

type HostDecision = "keep" | "remove";

function GuestFields({ device }: { device: Device }) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const edit = topologyStore.getState().edit;
  const id = device.id;
  const show = useIfNameFormatter();
  // ホストを変えると、今のホストのブリッジへのリンクが付け替えられないとき(フェーズ4-2 Q2)
  const [pending, setPending] = useState<{
    host: string | undefined;
    impact: HostChangeImpact;
  } | null>(null);
  const applyHost = (host: string | undefined, removeLost: boolean) =>
    edit((t) => changeHost(t, id, host, { removeLost }));
  const onHostChange = (value: string) => {
    const host = value === "" ? undefined : value;
    const impact = hostChangeImpact(topology, id, host);
    if (impact.lost.length > 0) setPending({ host, impact });
    else applyHost(host, false);
  };
  // 自分自身と、自分の上で動くゲストはホストにできない(輪になるため)
  const candidates = hostCandidates(topology, id);
  const isHypervisor = (other: string) => {
    const d = topology.devices.get(other);
    return d !== undefined && resolveRole(d, catalog) === "hypervisor";
  };
  const hypervisors = candidates.filter(isHypervisor);
  const others = candidates.filter((other) => !isHypervisor(other));
  const invalidHost = device.host !== undefined && !candidates.includes(device.host);

  return (
    <>
      <Field label="ホスト">
        <select
          className="field-input"
          aria-label="ホスト"
          value={device.host ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            e.currentTarget.blur();
            onHostChange(value);
          }}
        >
          <option value="">なし(図に描かないホスト)</option>
          {invalidHost && <option value={device.host}>使えないホスト: {device.host}</option>}
          {hypervisors.length > 0 && (
            <optgroup label={ROLE_LABELS.hypervisor}>
              {hypervisors.map((h) => (
                <option key={h} value={h}>
                  {hostName(topology, h)}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="そのほかの機器">
              {others.map((h) => (
                <option key={h} value={h}>
                  {hostName(topology, h)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Field>
      <Field label="VMID">
        <CommitInput
          label="VMID"
          monospace
          value={device.vmid?.toString() ?? ""}
          placeholder="例: 100"
          validate={vmidError}
          onCommit={(v) => edit((t) => setDeviceVmid(t, id, v === "" ? undefined : Number(v)))}
        />
      </Field>
      {pending && (
        <ConfirmDialog<HostDecision>
          title="ホストを変えますか?"
          actions={[
            { value: "keep", label: "変えて、そのまま残す" },
            { value: "remove", label: "変えて、リンクを消す", primary: true, danger: true },
          ]}
          onAction={(decision) => {
            applyHost(pending.host, decision === "remove");
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        >
          <p>
            {pending.host === undefined
              ? `ホストを「なし」にすると、${id} は次のリンクのブリッジにつなげなくなります(ブリッジにつなげるのは、そのホストの上で動くゲストだけです)。`
              : `${pending.host} には、${id} がつながっている次のブリッジがありません。`}
          </p>
          <ul>
            {pending.impact.lost.map((link) => {
              const [mine, bridge] = link.a?.device === id ? [link.a, link.b] : [link.b, link.a];
              return (
                <li key={link.id}>
                  {mine ? show(mine.iface) : "?"} ↔{" "}
                  {bridge ? `${bridge.device}:${show(bridge.iface)}` : "?"}
                </li>
              );
            })}
          </ul>
          {pending.impact.moved.length > 0 && (
            <p className="muted">
              同じ名前のブリッジがあるリンク({pending.impact.moved.length}{" "}
              本)は、新しいホストのブリッジに付け替えます。
            </p>
          )}
          <p className="muted">
            「そのまま残す」を選ぶと、これらのリンクはエラーとして表示されます。
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
