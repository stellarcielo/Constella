// リンクの線(SPEC 7.3)。デバイスのアイコンの中心同士を直線で結ぶ(フローティングエッジ)。
// 両端に IF 名、中央にリンクのラベルを出し、同じ 2 台の間の複数リンクは平行にずらす。
// 線の色と種類は media で決まる(Canvas.css)。

import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  useInternalNode,
} from "@xyflow/react";
import type { ReactNode } from "react";
import { expandIfName, type Media } from "../../core";
import { useUi } from "../../store";
import { iconCenter } from "./geometry";
import {
  endLabelPositions,
  midpoint,
  offsetLine,
  type Point,
  selfLoop,
  slotOffset,
} from "./linkGeometry";

export type LinkEdgeData = {
  media: Media;
  /** 両端の IF 名(短い形) */
  aName: string;
  bName: string;
  /** リンク中央に出す文字 */
  label?: string;
  /** 同じ 2 台の間(自分自身へのリンクなら同じデバイス)のリンクのうち何本目か */
  slotIndex: number;
  slotCount: number;
};

export type LinkEdgeType = Edge<LinkEdgeData, "link">;

export function LinkEdge({ id, source, target, data, selected }: EdgeProps<LinkEdgeType>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const view = useUi((state) => state.view);
  if (!s || !t || !data) return null;

  const show = (name: string) => (view.longIfNames ? expandIfName(name) : name);
  const aName = show(data.aName);
  const bName = show(data.bName);

  let path: string;
  let ends: { a: Point; b: Point };
  let center: Point;
  if (source === target) {
    const loop = selfLoop(iconCenter(s), data.slotIndex, data.label);
    path = loop.path;
    ends = { a: loop.labelA, b: loop.labelB };
    center = loop.label;
  } else {
    const slot = { index: data.slotIndex, count: data.slotCount };
    // ずらす向きは ID の小さいデバイス → 大きいデバイスを基準にする
    const line = offsetLine(iconCenter(s), iconCenter(t), slotOffset(slot), source > target);
    path = `M ${line.a.x},${line.a.y} L ${line.b.x},${line.b.y}`;
    ends = endLabelPositions(line.a, line.b, aName, bName, slot);
    center = midpoint(line.a, line.b);
  }

  const state = selected ? " selected" : "";
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={14} />
      <EdgeLabelRenderer>
        {view.showIfLabels && (
          <>
            <Label at={ends.a} className={`link-if-label${state}`}>
              {aName}
            </Label>
            <Label at={ends.b} className={`link-if-label${state}`}>
              {bName}
            </Label>
          </>
        )}
        {data.label && (
          <Label at={center} className={`link-label${state}`}>
            {data.label}
          </Label>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

function Label({ at, className, children }: { at: Point; className: string; children: ReactNode }) {
  return (
    <div
      className={className}
      style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
    >
      {children}
    </div>
  );
}
