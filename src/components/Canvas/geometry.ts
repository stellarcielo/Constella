import type { InternalNode } from "@xyflow/react";
import { BRIDGE_BOX } from "../../core";
import { DEVICE_ICON_BOX, DEVICE_NODE_WIDTH } from "./DeviceNode";

/** 線をつなぐ点(フロー座標)。デバイスはアイコンの中心、ブリッジは箱の中心(SPEC 7.3) */
export function iconCenter(node: InternalNode): { x: number; y: number } {
  const { x, y } = node.internals.positionAbsolute;
  const height = node.type === "bridge" ? BRIDGE_BOX.height : DEVICE_ICON_BOX;
  return { x: x + (node.measured.width ?? DEVICE_NODE_WIDTH) / 2, y: y + height / 2 };
}
