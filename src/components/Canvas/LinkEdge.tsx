// リンクの線(SPEC 7.3)。デバイスのアイコンの中心同士を直線で結ぶ(フローティングエッジ)。
// 中央にリンクのラベルを出し、同じ 2 台の間の複数リンクは平行にずらす。線の色と種類は media で決まる(Canvas.css)。
// ブリッジへのリンクはブリッジの箱につなぐ。両端の IF 名(その下に IP・VLAN。フェーズ3-2)は、
// 同じデバイスに付くほかの線のラベルと重ならないよう、EndLabels がまとめて置いて描く。

import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  useInternalNode,
} from "@xyflow/react";
import type { HTMLAttributes, ReactNode } from "react";
import {
  type InterfaceInfo,
  type Media,
  midpoint,
  offsetLine,
  type Point,
  selfLoop,
  slotOffset,
} from "../../core";
import { iconCenter } from "./geometry";
import type { CanvasNode } from "./nodes";

export type LinkEdgeData = {
  media: Media;
  /** 両端の IF 名(短い形) */
  aName: string;
  bName: string;
  /** 両端の IF の追加情報(IP・VLAN をラベルに出す) */
  aInfo?: InterfaceInfo;
  bInfo?: InterfaceInfo;
  /** 両端の IP の行(クラスタのネットワークの名前を添えたもの。フェーズ4-5) */
  aIps?: string[];
  bIps?: string[];
  /** リンク中央に出す文字 */
  label?: string;
  /** 同じ 2 台の間(自分自身へのリンクなら同じデバイス)のリンクのうち何本目か */
  slotIndex: number;
  slotCount: number;
  /** その端がブリッジか(IF 名を出さない) */
  aBridge?: boolean;
  bBridge?: boolean;
  /** その端の IF を束ねている bond(IF 名の下に添える。フェーズ4-3 Q2) */
  aBond?: string;
  bBond?: string;
};

export type LinkEdgeType = Edge<LinkEdgeData, "link">;

export function LinkEdge({ id, source, target, data, selected }: EdgeProps<LinkEdgeType>) {
  const s = useInternalNode<CanvasNode>(source);
  const t = useInternalNode<CanvasNode>(target);
  if (!s || !t || !data) return null;

  let path: string;
  let center: Point;
  if (source === target) {
    const loop = selfLoop(iconCenter(s), data.slotIndex, data.label);
    path = loop.path;
    center = loop.label;
  } else {
    const slot = { index: data.slotIndex, count: data.slotCount };
    // ずらす向きは ID の小さいデバイス → 大きいデバイスを基準にする(IF 名ラベルを分ける向きも同じ)
    const line = offsetLine(iconCenter(s), iconCenter(t), slotOffset(slot), source > target);
    path = `M ${line.a.x},${line.a.y} L ${line.b.x},${line.b.y}`;
    center = midpoint(line.a, line.b);
  }

  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={14} />
      {data.label && (
        <EdgeLabelRenderer>
          <Label at={center} className={`link-label${selected ? " selected" : ""}`}>
            {data.label}
          </Label>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** at を中心にして置くラベル(IF 名ラベルは EndLabels が使う。ドラッグなどの操作も渡せる) */
export function Label({
  at,
  className,
  children,
  ...props
}: {
  at: Point;
  className: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "style" | "children">) {
  return (
    <div
      {...props}
      className={className}
      style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
    >
      {children}
    </div>
  );
}
