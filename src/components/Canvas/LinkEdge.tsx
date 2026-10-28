// リンクの線。デバイスのアイコンの中心同士を直線で結ぶ(フローティングエッジ)。
// IF 名のラベル、並行リンクのずらし、media ごとの線の種類はタスク 1-6 で足す。

import { BaseEdge, type Edge, type EdgeProps, useInternalNode } from "@xyflow/react";
import { iconCenter } from "./geometry";

export type LinkEdgeType = Edge<Record<string, never>, "link">;

export function LinkEdge({ id, source, target }: EdgeProps<LinkEdgeType>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const a = iconCenter(s);
  const b = iconCenter(t);
  return <BaseEdge id={id} path={`M ${a.x},${a.y} L ${b.x},${b.y}`} interactionWidth={14} />;
}
