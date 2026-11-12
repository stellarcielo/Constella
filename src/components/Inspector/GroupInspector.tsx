// グループのインスペクタ(SPEC 7.5): ID・種類・ラベル・メンバー、クラスタのネットワーク(SPEC 4.6)、削除。
// 枠のラベルのクリック、トポロジのインスペクタのグループの一覧、問題パネルのグループの問題から開く。

import { type KeyboardEvent, useEffect, useId, useState } from "react";
import {
  addGroupMembers,
  checkGroupId,
  checkNetworkName,
  type Group,
  type GroupChanges,
  GROUP_KIND_LABELS,
  GROUP_KINDS,
  groupKindFilter,
  groupTitle,
  parseSubnet,
  removeGroup,
  removeGroupMembers,
  removeGroupNetwork,
  setGroupNetwork,
  updateGroup,
} from "../../core";
import { topologyStore, useTopology, useUi } from "../../store";
import { CommitInput, Field } from "./fields";
import { clearGroupLabelFocus, wantsGroupLabelFocus } from "./groupFocus";
import { IssueList } from "./IssueList";

/** ネットワークの名前の候補(SPEC 4.6 の例。Proxmox VE から取り込むときと同じ名前) */
const NETWORK_NAMES = ["corosync", "migration", "ceph-public", "ceph-cluster"];

const checkSubnet = (text: string) =>
  parseSubnet(text) ? undefined : "サブネットの書き方が分かりません(例: 10.10.0.0/24)";

/** ID の自然な順(group2 を group10 より前に) */
const byId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** 種類の選択肢の名前。YAML の値と読みが違えば、YAML の値を添える */
function kindOption(kind: (typeof GROUP_KINDS)[number]): string {
  const label = GROUP_KIND_LABELS[kind];
  return label.toLowerCase() === kind ? label : `${label}(${kind})`;
}

export function GroupInspector({ group }: { group: Group }) {
  const topology = useTopology((s) => s.topology);
  const issues = useTopology((s) => s.issues);
  const view = useUi((s) => s.view);
  const edit = topologyStore.getState().edit;
  const index = topology.groups.indexOf(group);
  const groupIssues = issues.filter((i) => i.target.kind === "group" && i.target.index === index);
  const update = (changes: GroupChanges) => edit((t) => updateGroup(t, group.uid, changes));

  // 作ったばかりなら、ラベル欄にカーソルを置く(Q1)
  const [focusLabel] = useState(() => wantsGroupLabelFocus(group.uid));
  useEffect(() => {
    if (focusLabel) clearGroupLabelFocus();
  }, [focusLabel]);

  const hidden = !view.showGroups
    ? "ツールバーの「グループ」が切ってあるので、枠を出していません。"
    : !groupKindFilter(view.groupKinds)(group)
      ? "今の表示レイヤーでは、この種類の枠を出していません。"
      : !group.members.some((id) => topology.devices.has(id))
        ? "図にあるメンバーがいないので、枠を出していません。"
        : undefined;

  return (
    <>
      <header className="inspector-header">
        <div className="inspector-heading">
          <div className="inspector-title">{groupTitle(group) || "(ID なし)"}</div>
          <div className="inspector-subtitle">グループ・メンバー {group.members.length} 台</div>
        </div>
      </header>

      <IssueList issues={groupIssues} />
      {hidden && <p className="muted">{hidden}</p>}

      <section className="inspector-section">
        <Field label="ID">
          <CommitInput
            label="グループの ID"
            monospace
            value={group.id}
            validate={(v) => checkGroupId(topology, v, group.id)}
            onCommit={(v) => update({ id: v })}
          />
        </Field>
        <Field label="種類">
          <select
            className="field-input"
            aria-label="グループの種類"
            value={group.kind ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              e.currentTarget.blur();
              update({ kind: GROUP_KINDS.find((k) => k === value) });
            }}
          >
            <option value="">種類なし</option>
            {GROUP_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kindOption(kind)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ラベル">
          <CommitInput
            label="グループのラベル"
            value={group.label ?? ""}
            placeholder={group.id}
            autoFocus={focusLabel}
            onCommit={(v) => update({ label: v })}
          />
        </Field>
      </section>

      <MemberList group={group} />
      {(group.kind === "cluster" || group.networks) && <NetworkList group={group} />}

      <section className="inspector-actions">
        <button
          type="button"
          className="inspector-button danger"
          title="グループを消す(メンバーの機器は残す)"
          onClick={() => edit((t) => removeGroup(t, group.uid))}
        >
          グループを削除
        </button>
      </section>
    </>
  );
}

/** メンバーの一覧(クリックでそのデバイスを選ぶ、× で外す)と、デバイスを選んで足す欄 */
function MemberList({ group }: { group: Group }) {
  const topology = useTopology((s) => s.topology);
  const store = topologyStore.getState();
  const members = [...new Set(group.members)];
  const candidates = [...topology.devices.values()]
    .filter((d) => !members.includes(d.id))
    .sort((a, b) => byId(a.id, b.id));
  // メンバーを変えたら、キャンバスで選んでいる機器もメンバーに合わせる
  const change = (recipe: Parameters<typeof store.edit>[0]) => {
    store.edit(recipe);
    topologyStore.getState().selectGroup(group.uid);
  };

  return (
    <section className="inspector-section">
      <div className="inspector-section-head">
        <h3>メンバー</h3>
        <span className="muted">{members.length} 台</span>
      </div>
      <ul className="if-list">
        {members.map((id) => {
          const device = topology.devices.get(id);
          return (
            <li key={id} className={`if-row${device ? "" : " unknown"}`}>
              <div className="if-row-head">
                <button
                  type="button"
                  className="if-row-toggle"
                  title="このデバイスを選択"
                  disabled={!device}
                  onClick={() => store.setSelection({ devices: [id], links: [] })}
                >
                  <span className="if-name mono">{id}</span>
                  {device?.label && <span className="if-desc">{device.label}</span>}
                  {!device && <span className="if-unknown">図にありません</span>}
                </button>
                <button
                  type="button"
                  className="if-row-remove"
                  title="このグループから外す"
                  aria-label={`${id} をグループから外す`}
                  onClick={() => change((t) => removeGroupMembers(t, group.uid, [id]))}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {members.length === 0 && <p className="muted">メンバーはいません</p>}
      {candidates.length > 0 && (
        <select
          className="field-input"
          aria-label="メンバーを追加"
          value=""
          onChange={(e) => {
            const id = e.target.value;
            e.currentTarget.blur();
            if (id !== "") change((t) => addGroupMembers(t, group.uid, [id]));
          }}
        >
          <option value="">＋ メンバーを追加…</option>
          {candidates.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label ? `${d.id}(${d.label})` : d.id}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}

/** クラスタのネットワーク(名前とサブネット)。行ごとに書き換え・削除し、最後の行で足す */
function NetworkList({ group }: { group: Group }) {
  const edit = topologyStore.getState().edit;
  const listId = useId();
  const [name, setName] = useState("");
  const [subnet, setSubnet] = useState("");
  const entries = [...(group.networks ?? [])];
  const nextName = name.trim();
  const nextSubnet = subnet.trim();
  const nameError = nextName === "" ? undefined : checkNetworkName(group, nextName);
  const subnetError = nextSubnet === "" ? undefined : checkSubnet(nextSubnet);
  const canAdd = nextName !== "" && nextSubnet !== "" && !nameError && !subnetError;

  const add = () => {
    if (!canAdd) return;
    edit((t) => setGroupNetwork(t, group.uid, nextName, nextSubnet));
    setName("");
    setSubnet("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      add();
    }
  };

  return (
    <section className="inspector-section">
      <div className="inspector-section-head">
        <h3>ネットワーク</h3>
        <span className="muted">{entries.length} 個</span>
      </div>
      {group.kind !== "cluster" && (
        <p className="muted">種類がクラスタでないので、ネットワークは使いません。</p>
      )}
      {entries.map(([networkName, text]) => (
        <div key={networkName} className="network-row">
          <div className="field-control">
            <CommitInput
              label="ネットワークの名前"
              monospace
              value={networkName}
              validate={(v) => checkNetworkName(group, v, networkName)}
              onCommit={(v) => edit((t) => setGroupNetwork(t, group.uid, v, text, networkName))}
            />
          </div>
          <div className="field-control">
            <CommitInput
              label={`${networkName} のサブネット`}
              monospace
              value={text}
              validate={checkSubnet}
              onCommit={(v) => edit((t) => setGroupNetwork(t, group.uid, networkName, v))}
            />
          </div>
          <button
            type="button"
            className="if-row-remove"
            title="このネットワークを消す"
            aria-label={`ネットワーク ${networkName} を消す`}
            onClick={() => edit((t) => removeGroupNetwork(t, group.uid, networkName))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="network-row">
        <input
          className="field-input mono"
          aria-label="足すネットワークの名前"
          aria-invalid={nameError ? true : undefined}
          placeholder="corosync"
          list={listId}
          value={name}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <input
          className="field-input mono"
          aria-label="足すネットワークのサブネット"
          aria-invalid={subnetError ? true : undefined}
          placeholder="10.10.0.0/24"
          value={subnet}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setSubnet(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="inspector-button" disabled={!canAdd} onClick={add}>
          追加
        </button>
      </div>
      {(nameError ?? subnetError) && <p className="field-error">{nameError ?? subnetError}</p>}
      <datalist id={listId}>
        {NETWORK_NAMES.filter((n) => !group.networks?.has(n)).map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <p className="muted">
        IP がこのサブネットに入るホストの IF は、ラベルの IP にネットワークの名前を添えます。
      </p>
    </section>
  );
}
