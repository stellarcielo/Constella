// ブリッジのインスペクタ(SPEC 4.6・フェーズ4-2 Q4): 名前・members・VLAN aware・通す VLAN・IP・説明と、
// つながっているゲストの一覧。ブリッジはホストの IF なので、変更はホストの interfaces に書く。

import {
  bridgeKey,
  bridgeLinks,
  bridgeMemberCandidates,
  checkBridgeName,
  type Device,
  type Endpoint,
  ifNameKey,
  type InterfaceChanges,
  interfaceInfo,
  normalizeIfName,
  renameBridge,
  updateInterface,
  vlanText,
} from "../../core";
import { topologyStore, useTopology } from "../../store";
import { useIfNameFormatter } from "../ifNames";
import { CommitInput, CommitTextarea, Field } from "./fields";
import { IssueList } from "./IssueList";

export function BridgeInspector({ host, bridge }: { host: Device; bridge: string }) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const issues = useTopology((s) => s.issues);
  const show = useIfNameFormatter();
  const edit = topologyStore.getState().edit;
  const info = host.interfaces.get(bridge);
  const key = bridgeKey(host.id, bridge);
  const links = bridgeLinks(topology, host.id, bridge);
  const update = (changes: InterfaceChanges) =>
    edit((t) => updateInterface(t, host.id, bridge, changes, catalog));

  const isThisBridge = (ep?: Endpoint) =>
    ep?.device === host.id && ifNameKey(ep.iface) === ifNameKey(bridge);
  const bridgeIssues = issues.filter((i) => {
    const target = i.target;
    if (target.kind === "interface") {
      return target.device === host.id && ifNameKey(target.name) === ifNameKey(bridge);
    }
    if (target.kind === "link") return links.some((l) => l.id === target.id);
    return target.kind === "layout" && target.id === key;
  });

  // members の候補(物理的な IF と bond・VLAN インターフェース)。候補に無いのに members にある IF も出す
  const members = info?.members ?? [];
  const has = (list: string[], name: string) => list.some((m) => ifNameKey(m) === ifNameKey(name));
  const candidates = bridgeMemberCandidates(host, topology, catalog);
  const choices = [...candidates, ...members.filter((m) => !has(candidates, m))];
  const toggle = (name: string, on: boolean) =>
    update({
      members: choices.filter((c) => (ifNameKey(c) === ifNameKey(name) ? on : has(members, c))),
    });

  const rename = (name: string) => {
    edit((t) => renameBridge(t, host.id, bridge, name));
    topologyStore
      .getState()
      .setSelection({ devices: [bridgeKey(host.id, normalizeIfName(name))], links: [] });
  };

  return (
    <>
      <header className="inspector-header">
        <div className="inspector-heading">
          <div className="inspector-title mono">{bridge}</div>
          <div className="inspector-subtitle">{host.id} のブリッジ(仮想スイッチ)</div>
        </div>
      </header>

      <IssueList issues={bridgeIssues} />

      <section className="inspector-section">
        <Field label="名前">
          <CommitInput
            label="ブリッジの名前"
            monospace
            value={bridge}
            validate={(v) => checkBridgeName(host, v, catalog, bridge)}
            onCommit={rename}
          />
        </Field>
        <Field label="members">
          {choices.length > 0 ? (
            <div className="member-list">
              {choices.map((name) => (
                <label key={name} className="member-item mono">
                  <input
                    type="checkbox"
                    checked={has(members, name)}
                    onChange={(e) => toggle(name, e.target.checked)}
                  />
                  {show(name)}
                </label>
              ))}
            </div>
          ) : (
            <span className="muted">つなげる IF がありません</span>
          )}
        </Field>
        <Field label="VLAN aware">
          <label className="member-item">
            <input
              type="checkbox"
              checked={info?.vlanAware === true}
              onChange={(e) => update({ vlanAware: e.target.checked ? true : undefined })}
            />
            VLAN を区別して通す
          </label>
        </Field>
        {info?.vlanAware === true && (
          <Field label="通す VLAN">
            <CommitInput
              label="通す VLAN"
              monospace
              placeholder="2-4094"
              value={info.vlans ?? ""}
              onCommit={(v) => update({ vlans: v })}
            />
          </Field>
        )}
        <Field label="IP">
          <CommitTextarea
            label="IP アドレス(1 行に 1 つ)"
            monospace
            rows={2}
            placeholder={"192.0.2.1/24\n2001:db8::1/64"}
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
        <Field label="説明">
          <CommitInput
            label="説明"
            value={info?.description ?? ""}
            onCommit={(v) => update({ description: v })}
          />
        </Field>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-head">
          <h3>つながっているゲスト</h3>
          <span className="muted">{links.length} 本</span>
        </div>
        <ul className="if-list">
          {links.map((link) => {
            const other = isThisBridge(link.a) ? link.b : link.a;
            const otherInfo =
              other && interfaceInfo(topology.devices.get(other.device), other.iface);
            const vlan = otherInfo && vlanText(otherInfo);
            return (
              <li key={link.id} className="if-row">
                <div className="if-row-head">
                  <button
                    type="button"
                    className="if-row-toggle"
                    title="このリンクを選択"
                    onClick={() =>
                      topologyStore.getState().setSelection({ devices: [], links: [link.id] })
                    }
                  >
                    <span className="if-name mono">
                      {other ? `${other.device}:${show(other.iface)}` : "?"}
                    </span>
                    {vlan && <span className="if-meta">{vlan}</span>}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {links.length === 0 && (
          <p className="muted">
            まだつながっていません(接続モードで、ゲストのあとにこのブリッジをクリックするとつながります)
          </p>
        )}
      </section>

      <section className="inspector-actions">
        <button
          type="button"
          className="inspector-button danger"
          onClick={() => topologyStore.getState().deleteElements({ devices: [key] })}
        >
          このブリッジを削除
        </button>
      </section>
    </>
  );
}
