// リンクの線(SPEC 7.3)。デバイスのアイコンの中心同士を直線で結ぶ(フローティングエッジ)。
// 両端に IF 名(その下に IP・VLAN。フェーズ3-2)、中央にリンクのラベルを出し、
// 同じ 2 台の間の複数リンクは平行にずらす。線の色と種類は media で決まる(Canvas.css)。

import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  useInternalNode,
} from "@xyflow/react";
import type { ReactNode } from "react";
import {
  endLabelPositions,
  estimateNameWidth,
  type IfLabel,
  ifLabel,
  ifLabelLines,
  type InterfaceInfo,
  type Media,
  midpoint,
  offsetLine,
  type Point,
  selfLoop,
  slotOffset,
} from "../../core";
import { useUi } from "../../store";
import { DEVICE_NODE_WIDTH, type DeviceNodeType } from "./DeviceNode";
import { iconCenter } from "./geometry";

export type LinkEdgeData = {
  media: Media;
  /** 両端の IF 名(短い形) */
  aName: string;
  bName: string;
  /** 両端の IF の追加情報(IP・VLAN をラベルに出す) */
  aInfo?: InterfaceInfo;
  bInfo?: InterfaceInfo;
  /** リンク中央に出す文字 */
  label?: string;
  /** 同じ 2 台の間(自分自身へのリンクなら同じデバイス)のリンクのうち何本目か */
  slotIndex: number;
  slotCount: number;
};

export type LinkEdgeType = Edge<LinkEdgeData, "link">;

export function LinkEdge({ id, source, target, data, selected }: EdgeProps<LinkEdgeType>) {
  const s = useInternalNode<DeviceNodeType>(source);
  const t = useInternalNode<DeviceNodeType>(target);
  const view = useUi((state) => state.view);
  if (!s || !t || !data) return null;

  const options = {
    showIfName: view.showIfLabels,
    longIfNames: view.longIfNames,
    showIp: view.showIp,
    showVlan: view.showVlan,
  };
  const aLabel = ifLabel(data.aName, data.aInfo, options);
  const bLabel = ifLabel(data.bName, data.bInfo, options);
  const aLines = aLabel ? ifLabelLines(aLabel) : [];
  const bLines = bLabel ? ifLabelLines(bLabel) : [];

  let path: string;
  let ends: { a: Point; b: Point };
  let center: Point;
  if (source === target) {
    const loop = selfLoop(iconCenter(s), data.slotIndex, data.label, { a: aLines, b: bLines });
    path = loop.path;
    ends = { a: loop.labelA, b: loop.labelB };
    center = loop.label;
  } else {
    const slot = { index: data.slotIndex, count: data.slotCount };
    // ずらす向きは ID の小さいデバイス → 大きいデバイスを基準にする
    const line = offsetLine(iconCenter(s), iconCenter(t), slotOffset(slot), source > target);
    path = `M ${line.a.x},${line.a.y} L ${line.b.x},${line.b.y}`;
    // デバイス名はノードの幅で切れて表示される(Canvas.css)ので、それより広くはならない
    const nameWidth = (label: string) => Math.min(estimateNameWidth(label), DEVICE_NODE_WIDTH);
    ends = endLabelPositions(line.a, line.b, aLines, bLines, slot, {
      a: nameWidth(s.data.label),
      b: nameWidth(t.data.label),
    });
    center = midpoint(line.a, line.b);
  }

  const state = selected ? " selected" : "";
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={14} />
      <EdgeLabelRenderer>
        {aLabel && <IfLabelBox at={ends.a} label={aLabel} className={`link-if-label${state}`} />}
        {bLabel && <IfLabelBox at={ends.b} label={bLabel} className={`link-if-label${state}`} />}
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

/** 両端のラベル。IF 名の下に、IP・VLAN を 1 行ずつ小さく出す */
function IfLabelBox({ at, label, className }: { at: Point; label: IfLabel; className: string }) {
  return (
    <Label at={at} className={className}>
      {label.name !== undefined && <div>{label.name}</div>}
      {label.details.map((line, i) => (
        <div key={i} className="link-if-detail">
          {line}
        </div>
      ))}
    </Label>
  );
}
