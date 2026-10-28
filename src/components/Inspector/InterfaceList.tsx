// デバイスの IF 一覧と使用状況。行を開くと IF の詳細(SPEC 4.3)を編集できる。

import { useMemo, useState } from "react";
import {
  type Device,
  expandIfName,
  ifNameKey,
  INTERFACE_MODES,
  type InterfaceChanges,
  type InterfaceInfo,
  type InterfaceMode,
  isFlexibleDevice,
  listDevicePorts,
  updateInterface,
} from "../../core";
import { topologyStore, useTopology } from "../../store";
import { useIfNameFormatter } from "../ifNames";
import { PORT_TYPE_LABELS } from "../portTypes";
import { CommitInput, CommitTextarea, Field } from "./fields";

export function InterfaceList({ device }: { device: Device }) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const show = useIfNameFormatter();
  const [query, setQuery] = useState("");
  const [usedOnly, setUsedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const flexible = isFlexibleDevice(device, catalog);
  const entries = useMemo(
    () => listDevicePorts(device, topology, catalog),
    [device, topology, catalog],
  );
  const infoOf = (name: string): InterfaceInfo | undefined => {
    const key = ifNameKey(name);
    for (const [n, info] of device.interfaces) if (ifNameKey(n) === key) return info;
    return undefined;
  };

  const q = query.trim().toLowerCase();
  const visible = entries.filter(
    (e) =>
      (!usedOnly || e.use) &&
      (q === "" ||
        e.name.toLowerCase().includes(q) ||
        expandIfName(e.name).toLowerCase().includes(q) ||
        (infoOf(e.name)?.description ?? "").toLowerCase().includes(q)),
  );
  const used = entries.filter((e) => e.use).length;
  const total = flexible ? entries.length : entries.filter((e) => e.defined).length;

  return (
    <section className="inspector-section">
      <div className="inspector-section-head">
        <h3>インターフェース</h3>
        <span className="muted">
          使用中 {used} / {total}
        </span>
      </div>
      {entries.length > 0 && (
        <div className="if-tools">
          <input
            className="field-input"
            type="search"
            aria-label="IF を検索"
            placeholder="IF を検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="if-used-only">
            <input
              type="checkbox"
              checked={usedOnly}
              onChange={(e) => setUsedOnly(e.target.checked)}
            />
            使用中だけ
          </label>
        </div>
      )}
      <ul className="if-list">
        {visible.map((entry) => {
          const info = infoOf(entry.name);
          const unknown = !entry.defined && !flexible;
          const isOpen = open !== null && ifNameKey(open) === ifNameKey(entry.name);
          const peer = entry.use?.peer;
          const linkId = entry.use?.linkId;
          return (
            <li
              key={entry.name}
              className={["if-row", isOpen && "open", unknown && "unknown"]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="if-row-head">
                <button
                  type="button"
                  className="if-row-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : entry.name)}
                >
                  <span className="if-name mono">{show(entry.name)}</span>
                  {entry.type && <span className="if-meta">{PORT_TYPE_LABELS[entry.type]}</span>}
                  {entry.speed && <span className="if-meta">{entry.speed}</span>}
                  {unknown && <span className="if-unknown">モデルにない IF</span>}
                  {info?.description && <span className="if-desc">{info.description}</span>}
                </button>
                {linkId ? (
                  <button
                    type="button"
                    className="if-peer mono"
                    title="このリンクを選択"
                    onClick={() =>
                      topologyStore.getState().setSelection({ devices: [], links: [linkId] })
                    }
                  >
                    → {peer ? `${peer.device}:${show(peer.iface)}` : "使用中"}
                  </button>
                ) : (
                  <span className="if-free">空き</span>
                )}
              </div>
              {isOpen && <InterfaceEditor device={device} name={entry.name} info={info} />}
            </li>
          );
        })}
      </ul>
      {entries.length === 0 && <p className="muted">IF はまだありません(接続すると増えます)</p>}
      {entries.length > 0 && visible.length === 0 && (
        <p className="muted">一致する IF がありません</p>
      )}
    </section>
  );
}

const isMode = (value: string): value is InterfaceMode =>
  (INTERFACE_MODES as readonly string[]).includes(value);

const vlanError = (value: string): string | undefined =>
  value === "" || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 4094)
    ? undefined
    : "1〜4094 の整数を入力してください";

/** IF の詳細(SPEC 4.3)。すべて空にすると YAML から IF の設定ごと消える */
function InterfaceEditor({
  device,
  name,
  info,
}: {
  device: Device;
  name: string;
  info?: InterfaceInfo;
}) {
  const catalog = useTopology((s) => s.catalog);
  const update = (changes: InterfaceChanges) =>
    topologyStore.getState().edit((t) => updateInterface(t, device.id, name, changes, catalog));
  const mode = info?.mode;
  return (
    <div className="if-editor">
      <Field label="説明">
        <CommitInput
          label="説明"
          value={info?.description ?? ""}
          onCommit={(v) => update({ description: v })}
        />
      </Field>
      <Field label="モード">
        <select
          className="field-input"
          aria-label="モード"
          value={mode ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            e.currentTarget.blur();
            update({ mode: isMode(value) ? value : undefined });
          }}
        >
          <option value="">指定なし</option>
          {INTERFACE_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      {(mode === "access" || info?.vlan !== undefined) && (
        <Field label="VLAN">
          <CommitInput
            label="VLAN"
            monospace
            placeholder="1〜4094"
            value={info?.vlan?.toString() ?? ""}
            validate={vlanError}
            onCommit={(v) => update({ vlan: v === "" ? undefined : Number(v) })}
          />
        </Field>
      )}
      {(mode === "trunk" || info?.vlans !== undefined) && (
        <Field label="許可 VLAN">
          <CommitInput
            label="許可 VLAN"
            monospace
            placeholder="10,20,100-110"
            value={info?.vlans ?? ""}
            onCommit={(v) => update({ vlans: v })}
          />
        </Field>
      )}
      <Field label="IP">
        <CommitTextarea
          label="IP アドレス(1 行に 1 つ)"
          monospace
          rows={2}
          placeholder={"192.0.2.1/30\n2001:db8::1/64"}
          value={(info?.ip ?? []).join("\n")}
          onCommit={(v) =>
            update({
              ip: v
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line !== ""),
            })
          }
        />
      </Field>
    </div>
  );
}
