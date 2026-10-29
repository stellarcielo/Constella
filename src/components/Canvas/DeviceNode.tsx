// キャンバス上のデバイス(アイコン + ラベル)。ポートが多いため接続点のハンドルは表示しない(SPEC 7.3)。

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { GuestKind, Role, Severity } from "../../core";
import { RoleIcon } from "../../icons/RoleIcon";
import { GUEST_LABELS } from "../../icons/roles";

export type DeviceNodeData = {
  label: string;
  role: Role;
  /** ツールチップに出すモデル名 */
  modelName?: string;
  /** ゲストなら種類(アイコンに VM / CT の印を付ける) */
  guest?: GuestKind;
  /** ツールチップに出すホストと VMID */
  host?: string;
  vmid?: number;
  /** そのデバイスに関する問題のうち、いちばん重いもの */
  problem?: Severity;
};

export type DeviceNodeType = Node<DeviceNodeData, "device">;

/** ノードの幅(CSS と合わせる)。ドロップ位置をアイコンの中心にするために使う */
export const DEVICE_NODE_WIDTH = 96;
export const DEVICE_ICON_BOX = 52;

/** アイコンに重ねる印(Proxmox VE の画面と同じく、コンテナは CT) */
const GUEST_BADGES: Record<GuestKind, string> = { vm: "VM", container: "CT" };

/** ツールチップ。「web01(Virtual Machine)」の下に、ゲストならホストと VMID を添える */
function tooltip(id: string, data: DeviceNodeData): string {
  const lines = [data.modelName ? `${id}(${data.modelName})` : id];
  if (data.guest) {
    const where = data.host ? `${data.host} の上の ` : "";
    lines.push(`${where}${GUEST_LABELS[data.guest]}`);
  }
  if (data.vmid !== undefined) lines.push(`VMID ${data.vmid}`);
  return lines.join("\n");
}

export function DeviceNode({ id, data, selected }: NodeProps<DeviceNodeType>) {
  const classes = [
    "device-node",
    selected && "selected",
    data.problem && `problem-${data.problem}`,
  ];
  return (
    <div className={classes.filter(Boolean).join(" ")} title={tooltip(id, data)}>
      <div className={`device-node-icon role-icon role-${data.role}`}>
        <RoleIcon role={data.role} size={34} />
        {data.guest && <span className="device-guest-badge">{GUEST_BADGES[data.guest]}</span>}
      </div>
      <div className="device-node-label">{data.label}</div>
      {/* React Flow は線を描くのにハンドルが必要。線は中心同士を結ぶので見えないようにしておく */}
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
