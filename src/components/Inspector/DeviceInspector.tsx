// デバイスのインスペクタ: ID・ラベル・モデル・role・IF 一覧(SPEC 7.1)。

import { useState } from "react";
import {
  changeModel,
  checkDeviceId,
  type Device,
  type Endpoint,
  findModel,
  type Link,
  type ModelChangeImpact,
  modelChangeImpact,
  resolveLabel,
  resolveRole,
  type Role,
  ROLES,
  setDeviceLabel,
  setDeviceRole,
} from "../../core";
import { RoleIcon } from "../../icons/RoleIcon";
import { ROLE_LABELS, ROLE_ORDER } from "../../icons/roles";
import { topologyStore, useTopology } from "../../store";
import { ConfirmDialog } from "../Dialog/ConfirmDialog";
import { useIfNameFormatter } from "../ifNames";
import { CommitInput, Field } from "./fields";
import { InterfaceList } from "./InterfaceList";
import { IssueList } from "./IssueList";

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

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

  const models = [...catalog.values()];
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
            {ROLE_ORDER.map((r) => {
              const group = models
                .filter((m) => m.role === r)
                .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
              if (group.length === 0) return null;
              return (
                <optgroup key={r} label={ROLE_LABELS[r]}>
                  {group.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.id}
                    </option>
                  ))}
                </optgroup>
              );
            })}
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
      </section>

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
