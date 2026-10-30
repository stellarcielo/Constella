// ブリッジ(ホストの中の仮想スイッチ。SPEC 4.6・7.3)の箱。名前を中に、VLAN aware の印を右上に、IP を下に出す。
// 幅は機器と同じにして、箱を真ん中に置く(線は箱の中心につなぐ)。

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { Severity } from "../../core";
import { useUi } from "../../store";

export type BridgeNodeData = {
  /** ブリッジの名前(vmbr0 など) */
  name: string;
  /** ホストのデバイスID */
  host: string;
  vlanAware: boolean;
  /** VLAN aware のとき通す VLAN(ツールチップに出す) */
  vlans?: string;
  ip: string[];
  /** そのブリッジに関する問題のうち、いちばん重いもの */
  problem?: Severity;
};

export type BridgeNodeType = Node<BridgeNodeData, "bridge">;

export function BridgeNode({ data, selected }: NodeProps<BridgeNodeType>) {
  const showIp = useUi((s) => s.view.showIp);
  const classes = [
    "bridge-node",
    selected && "selected",
    data.problem && `problem-${data.problem}`,
  ];
  const title = [
    `${data.host} のブリッジ ${data.name}`,
    data.vlanAware && `VLAN aware(通す VLAN: ${data.vlans ?? "2-4094"})`,
  ].filter(Boolean);
  return (
    <div className={classes.filter(Boolean).join(" ")} title={title.join("\n")}>
      <div className="bridge-node-box">
        {data.name}
        {data.vlanAware && <span className="bridge-vlan-badge">VLAN</span>}
      </div>
      {showIp &&
        data.ip.map((ip) => (
          <div key={ip} className="bridge-node-ip">
            {ip}
          </div>
        ))}
      {/* React Flow は線を描くのにハンドルが必要。線は箱の中心につなぐので見えないようにしておく */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="device-handle"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="device-handle"
      />
    </div>
  );
}
