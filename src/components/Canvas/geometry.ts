import type { InternalNode } from "@xyflow/react";
import { BRIDGE_BOX, commonMove, moveBends, type Position } from "../../core";
import type { BendDrag } from "../../store";
import { DEVICE_ICON_BOX, DEVICE_NODE_WIDTH } from "./DeviceNode";

/** 線をつなぐ点(フロー座標)。デバイスはアイコンの中心、ブリッジは箱の中心(SPEC 7.3) */
export function iconCenter(node: InternalNode): { x: number; y: number } {
  const { x, y } = node.internals.positionAbsolute;
  const height = node.type === "bridge" ? BRIDGE_BOX.height : DEVICE_ICON_BOX;
  return { x: x + (node.measured.width ?? DEVICE_NODE_WIDTH) / 2, y: y + height / 2 };
}

/**
 * リンクの線の曲げる点(LinkEdge のデータの一部。SPEC 7.3)。
 * React Flow のデータは Record<string, unknown> に当てはまる必要があるので、interface ではなく type にする
 */
export type EdgeBends = {
  /** 曲げる点のキー(bendKey)。自分自身へのリンクには無い */
  bendKey?: string;
  /** 曲げる点(キーの順。名前の小さいノードの側から) */
  bends: Position[];
  /** ストアにある両端のノードの位置(ドラッグ中に動いた量を測る) */
  sourceAt?: Position;
  targetAt?: Position;
};

/**
 * 今の曲げる点(キーの順)。点をドラッグしている間はその点、
 * 両端のノードをそろってドラッグしている間は、その分だけ動かした点(ドロップするとストアも同じだけ動かす)
 */
export function liveBends(
  data: EdgeBends,
  source: InternalNode,
  target: InternalNode,
  drag: BendDrag | undefined,
): Position[] {
  if (data.bendKey === undefined) return [];
  if (drag?.key === data.bendKey) return drag.points;
  const moved = (node: InternalNode, at: Position | undefined) =>
    at && {
      x: node.internals.positionAbsolute.x - at.x,
      y: node.internals.positionAbsolute.y - at.y,
    };
  const delta = commonMove(moved(source, data.sourceAt), moved(target, data.targetAt));
  return delta ? moveBends(data.bends, delta) : data.bends;
}
