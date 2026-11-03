// ホストの bond と VLAN インターフェース(SPEC 4.6・フェーズ4-3 Q3)。行を開くと編集できる。
// キャンバスには箱を置かず、ラベルに出す(ブリッジは BridgeInspector で編集する)。

import { useState } from "react";
import {
  addBond,
  addVlanInterface,
  BOND_MODES,
  type BondMode,
  bondMemberCandidates,
  bridgesOf,
  checkLogicalIfName,
  type Device,
  ifNameKey,
  type InterfaceChanges,
  type InterfaceInfo,
  logicalIfsOf,
  memberOwner,
  removeLogicalIf,
  renameLogicalIf,
  updateInterface,
  vlanInterface,
  vlanParentCandidates,
} from "../../core";
import { topologyStore, useTopology } from "../../store";
import { useIfNameFormatter } from "../ifNames";
import { CommitInput, CommitTextarea, Field } from "./fields";

const isBondMode = (value: string): value is BondMode =>
  (BOND_MODES as readonly string[]).includes(value);

const vidError = (value: string): string | undefined =>
  /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 4094
    ? undefined
    : "1〜4094 の整数を入力してください";

export function LogicalIfList({ device }: { device: Device }) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const show = useIfNameFormatter();
  const [open, setOpen] = useState<string | null>(null);
  const edit = topologyStore.getState().edit;
  const items = [...logicalIfsOf(device, "bond"), ...logicalIfsOf(device, "vlan")];

  const add = (type: "bond" | "vlan") => {
    // VLAN インターフェースの親は、最初のブリッジ(無ければ bond、物理的な IF)にしておく
    const parent =
      bridgesOf(device)[0] ??
      logicalIfsOf(device, "bond")[0] ??
      vlanParentCandidates(device, topology, catalog)[0] ??
      "eth0";
    let name: string | undefined;
    edit((t) => {
      name =
        type === "bond"
          ? addBond(t, device.id, catalog)
          : addVlanInterface(t, device.id, parent, catalog);
    });
    if (name !== undefined) setOpen(name);
  };

  const summary = (name: string, info: InterfaceInfo) => {
    if (info.type === "bond") {
      const members = (info.members ?? []).map(show).join(" + ") || "メンバーなし";
      return info.bondMode ? `${members}(${info.bondMode})` : members;
    }
    const { parent, vid } = vlanInterface(name, info);
    return `${parent === undefined ? "?" : show(parent)} の VLAN ${vid ?? "?"}`;
  };

  return (
    <section className="inspector-section">
      <div className="inspector-section-head">
        <h3>bond・VLAN インターフェース</h3>
        <span className="inspector-head-buttons">
          <button
            type="button"
            className="inspector-button"
            title="NIC を束ねる bond を足す"
            onClick={() => add("bond")}
          >
            ＋ bond
          </button>
          <button
            type="button"
            className="inspector-button"
            title="VLAN インターフェース(親.VLAN ID)を足す"
            onClick={() => add("vlan")}
          >
            ＋ VLAN
          </button>
        </span>
      </div>
      <ul className="if-list">
        {items.map((name) => {
          const info = device.interfaces.get(name);
          if (!info) return null;
          const isOpen = open !== null && ifNameKey(open) === ifNameKey(name);
          return (
            <li key={name} className={`if-row${isOpen ? " open" : ""}`}>
              <div className="if-row-head">
                <button
                  type="button"
                  className="if-row-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : name)}
                >
                  <span className="if-name mono">{show(name)}</span>
                  <span className="if-meta">{info.type === "bond" ? "bond" : "VLAN"}</span>
                  <span className="if-desc mono">{summary(name, info)}</span>
                </button>
              </div>
              {isOpen && (
                <LogicalIfEditor
                  device={device}
                  name={name}
                  info={info}
                  onRename={(next) => setOpen(next)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {items.length === 0 && <p className="muted">まだありません</p>}
    </section>
  );
}

/** bond(members・モード)と VLAN インターフェース(親・VLAN ID)の編集。IP・説明・削除は共通 */
function LogicalIfEditor({
  device,
  name,
  info,
  onRename,
}: {
  device: Device;
  name: string;
  info: InterfaceInfo;
  onRename(name: string): void;
}) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const show = useIfNameFormatter();
  const edit = topologyStore.getState().edit;
  const update = (changes: InterfaceChanges) =>
    edit((t) => updateInterface(t, device.id, name, changes, catalog));
  const rename = (next: string) => {
    let renamed: string | undefined;
    edit((t) => {
      renamed = renameLogicalIf(t, device.id, name, next);
    });
    if (renamed !== undefined) onRename(renamed);
  };

  return (
    <div className="if-editor">
      <Field label="名前">
        <CommitInput
          label="名前"
          monospace
          value={name}
          validate={(v) => checkLogicalIfName(device, v, catalog, name)}
          onCommit={rename}
        />
      </Field>
      {info.type === "bond" ? (
        <BondFields device={device} name={name} info={info} update={update} />
      ) : (
        <VlanFields
          device={device}
          name={name}
          info={info}
          update={update}
          rename={rename}
          parents={vlanParentCandidates(device, topology, catalog).filter(
            (p) => ifNameKey(p) !== ifNameKey(name),
          )}
          show={show}
        />
      )}
      <Field label="IP">
        <CommitTextarea
          label="IP アドレス(1 行に 1 つ)"
          monospace
          rows={2}
          placeholder={"192.0.2.1/24\n2001:db8::1/64"}
          value={(info.ip ?? []).join("\n")}
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
      <Field label="説明">
        <CommitInput
          label="説明"
          value={info.description ?? ""}
          onCommit={(v) => update({ description: v })}
        />
      </Field>
      <div className="inspector-actions">
        <button
          type="button"
          className="inspector-button danger"
          onClick={() => edit((t) => removeLogicalIf(t, device.id, name))}
        >
          削除
        </button>
      </div>
    </div>
  );
}

/** bond の members(物理的な IF)とモード */
function BondFields({
  device,
  name,
  info,
  update,
}: {
  device: Device;
  name: string;
  info: InterfaceInfo;
  update(changes: InterfaceChanges): void;
}) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const show = useIfNameFormatter();
  const members = info.members ?? [];
  const has = (list: string[], n: string) => list.some((m) => ifNameKey(m) === ifNameKey(n));
  const candidates = bondMemberCandidates(device, topology, catalog);
  const choices = [...candidates, ...members.filter((m) => !has(candidates, m))];
  const toggle = (member: string, on: boolean) =>
    update({
      members: choices.filter((c) => (ifNameKey(c) === ifNameKey(member) ? on : has(members, c))),
    });
  return (
    <>
      <Field label="members">
        <div className="member-list">
          {choices.map((member) => {
            const checked = has(members, member);
            // ほかの bond・ブリッジに入っている IF は選べない(外すことはできる)
            const owner = memberOwner(device, member, name);
            return (
              <label key={member} className="member-item mono">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && owner !== undefined}
                  onChange={(e) => toggle(member, e.target.checked)}
                />
                {show(member)}
                {owner !== undefined && <span className="muted">({show(owner)})</span>}
              </label>
            );
          })}
        </div>
      </Field>
      <Field label="モード">
        <select
          className="field-input"
          aria-label="bond のモード"
          value={info.bondMode ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            e.currentTarget.blur();
            update({ bondMode: isBondMode(value) ? value : undefined });
          }}
        >
          <option value="">指定なし</option>
          {BOND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

/**
 * VLAN インターフェースの親と VLAN ID。名前が「親.VLAN ID」の形なら、変えると名前も変える。
 * それ以外の名前(vlan10 など)なら、vlan-raw-device と vlan に書く
 */
function VlanFields({
  device,
  name,
  info,
  update,
  rename,
  parents,
  show,
}: {
  device: Device;
  name: string;
  info: InterfaceInfo;
  update(changes: InterfaceChanges): void;
  rename(name: string): void;
  parents: string[];
  show(name: string): string;
}) {
  const catalog = useTopology((s) => s.catalog);
  const { parent, vid } = vlanInterface(name, info);
  const derived =
    info.vlanRawDevice === undefined && info.vlan === undefined && /^.+\.\d+$/.test(name);
  /** 名前を「親.VLAN ID」にそろえられれば変え、できなければ項目に書く */
  const apply = (nextParent: string | undefined, nextVid: number | undefined) => {
    const next = `${nextParent}.${nextVid}`;
    if (
      derived &&
      nextParent !== undefined &&
      nextVid !== undefined &&
      checkLogicalIfName(device, next, catalog, name) === undefined
    ) {
      rename(next);
    } else {
      update({ vlanRawDevice: nextParent, vlan: nextVid });
    }
  };
  const choices =
    parent !== undefined && !parents.some((p) => ifNameKey(p) === ifNameKey(parent))
      ? [parent, ...parents]
      : parents;
  return (
    <>
      <Field label="親">
        <select
          className="field-input mono"
          aria-label="親の IF"
          value={parent ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            e.currentTarget.blur();
            apply(value === "" ? undefined : value, vid);
          }}
        >
          {parent === undefined && <option value="">(選んでください)</option>}
          {choices.map((p) => (
            <option key={p} value={p}>
              {show(p)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="VLAN ID">
        <CommitInput
          label="VLAN ID"
          monospace
          placeholder="1〜4094"
          value={vid?.toString() ?? ""}
          validate={vidError}
          onCommit={(v) => apply(parent, Number(v))}
        />
      </Field>
    </>
  );
}
