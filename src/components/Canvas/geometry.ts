import type { InternalNode } from "@xyflow/react";
import { DEVICE_ICON_BOX, DEVICE_NODE_WIDTH } from "./DeviceNode";

/** デバイスのアイコンの中心(フロー座標) */
export function iconCenter(node: InternalNode): { x: number; y: number } {
  const { x, y } = node.internals.positionAbsolute;
  return { x: x + (node.measured.width ?? DEVICE_NODE_WIDTH) / 2, y: y + DEVICE_ICON_BOX / 2 };
}
