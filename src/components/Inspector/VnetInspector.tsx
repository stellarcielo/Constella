// VNet の箱のインスペクタ(SPEC 7.1・フェーズ4-6 Q4)。ゾーン・tag・subnets と、このホストでつながっている
// ゲストを表示する。ゾーンと VNet は YAML の sdn で書く(ここでは編集しない)。
// 「このホストから外す」は、このホストの VNet の箱(つながっていたリンクと位置)を消す。VNet の定義は残る。

import {
  bridgeKey,
  bridgeLinks,
  type Device,
  type Endpoint,
  ifNameKey,
  interfaceInfo,
  vlanText,
  vnetTagText,
  zoneOfVnet,
} from "../../core";
import { topologyStore, useTopology } from "../../store";
import { useIfNameFormatter } from "../ifNames";
import { IssueList } from "./IssueList";

export function VnetInspector({ host, vnet }: { host: Device; vnet: string }) {
  const topology = useTopology((s) => s.topology);
  const issues = useTopology((s) => s.issues);
  const show = useIfNameFormatter();
  const info = topology.sdn.vnets.get(vnet);
  const zone = zoneOfVnet(topology, vnet);
  const key = bridgeKey(host.id, vnet);
  const links = bridgeLinks(topology, host.id, vnet);
  const tag = vnetTagText(topology, vnet) ?? (info?.tag === undefined ? "なし" : String(info.tag));

  const isThisVnet = (ep?: Endpoint) =>
    ep?.device === host.id && ifNameKey(ep.iface) === ifNameKey(vnet);
  const vnetIssues = issues.filter((i) => {
    const target = i.target;
    if (target.kind === "sdn") return target.section === "vnets" && target.id === vnet;
    if (target.kind === "link") return links.some((l) => l.id === target.id);
    return target.kind === "layout" && target.id === key;
  });

  return (
    <>
      <header className="inspector-header">
        <div className="inspector-heading">
          <div className="inspector-title mono">{vnet}</div>
          <div className="inspector-subtitle">{host.id} の VNet(SDN)</div>
        </div>
      </header>

      <IssueList issues={vnetIssues} />

      <section className="inspector-section">
        <dl className="inspector-stats">
          <dt>ゾーン</dt>
          <dd className="mono">
            {info?.zone ?? "?"}
            {zone?.type && <span className="muted">({zone.type})</span>}
          </dd>
          {zone?.bridge !== undefined && (
            <>
              <dt>ブリッジ</dt>
              <dd className="mono">{zone.bridge}</dd>
            </>
          )}
          <dt>tag</dt>
          <dd className="mono">{tag}</dd>
          <dt>subnets</dt>
          <dd className="mono">
            {info?.subnets?.length ? info.subnets.map((s) => <div key={s}>{s}</div>) : "なし"}
          </dd>
        </dl>
        <p className="muted">ゾーンと VNet は、YAML の sdn で編集します</p>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-head">
          <h3>つながっているゲスト</h3>
          <span className="muted">{links.length} 本</span>
        </div>
        <ul className="if-list">
          {links.map((link) => {
            const other = isThisVnet(link.a) ? link.b : link.a;
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
            まだつながっていません(接続モードで、ゲストのあとにこの VNet
            をクリックするとつながります)
          </p>
        )}
      </section>

      <section className="inspector-actions">
        <button
          type="button"
          className="inspector-button danger"
          title="このホストの VNet の箱と、つながっていたリンクを消します(VNet の定義は残ります)"
          onClick={() => topologyStore.getState().deleteElements({ devices: [key] })}
        >
          このホストから外す
        </button>
      </section>
    </>
  );
}
