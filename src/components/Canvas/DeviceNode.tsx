// キャンバス上のデバイス(アイコン + ラベル)。ポートが多いため接続点のハンドルは表示しない(SPEC 7.3)。

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { Role, Severity } from "../../core";
import { RoleIcon } from "../../icons/RoleIcon";

export type DeviceNodeData = {
  label: string;
  role: Role;
  /** ツールチップに出すモデル名 */
  modelName?: string;
  /** そのデバイスに関する問題のうち、いちばん重いもの */
  problem?: Severity;
};

export type DeviceNodeType = Node<DeviceNodeData, "device">;

/** ノードの幅(CSS と合わせる)。ドロップ位置をアイコンの中心にするために使う */
export const DEVICE_NODE_WIDTH = 96;
export const DEVICE_ICON_BOX = 52;

export function DeviceNode({ id, data, selected }: NodeProps<DeviceNodeType>) {
  const classes = [
    "device-node",
    selected && "selected",
    data.problem && `problem-${data.problem}`,
  ];
  return (
    <div
      className={classes.filter(Boolean).join(" ")}
      title={data.modelName ? `${id}(${data.modelName})` : id}
    >
      <div className={`device-node-icon role-icon role-${data.role}`}>
        <RoleIcon role={data.role} size={34} />
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
