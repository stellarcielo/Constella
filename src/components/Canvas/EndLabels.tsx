// リンク両端の IF 名ラベル(SPEC 7.3)。線ごとではなく、全部の線のラベルをここでまとめて置いて描く
// (同じデバイスに付く、別々の線のラベルを重ねないため。placeEndLabels)。
// ブリッジとホストの間の線のホスト側のラベル(ブリッジの members。bond なら束ねた IF とモードも。
// フェーズ4-2 Q3・4-3 Q2)と、自分自身へのリンクの輪のラベルもここで描く。線は LinkEdge・UplinkEdge が描く。
// 選択モードでは、ラベルをドラッグで動かせる(位置は layout._labels に、ドロップしたときに 1 回書く)。
// ダブルクリックで自動の位置に戻し、クリックでそのリンクを選ぶ。自分自身へのリンクの輪のラベルは動かせない。
// ReactFlow の子として置く(フローの座標変換と、ドラッグ中の位置を使うため)。

import {
  EdgeLabelRenderer,
  type InternalNode,
  useEdges,
  useNodes,
  useReactFlow,
} from "@xyflow/react";
import { type PointerEvent, useRef, useState } from "react";
import {
  endLabelOffset,
  estimateNameWidth,
  expandIfName,
  type IfLabel,
  ifLabel,
  ifLabelLines,
  type LabeledLine,
  type LabelEnd,
  type LabelOffset,
  labelKey,
  nameDetails,
  orientBends,
  placeEndLabels,
  type Point,
  selfLoop,
  uplinkLabelLines,
} from "../../core";
import { topologyStore, useTopology, useUi } from "../../store";
import { DEVICE_NODE_WIDTH } from "./DeviceNode";
import { iconCenter, liveBends } from "./geometry";
import { Label } from "./LinkEdge";
import type { CanvasEdge, CanvasNode } from "./nodes";

/** 端のラベルと、その位置のキー(labelKey) */
interface EndText {
  label: IfLabel;
  key: string;
}

/** 線のラベル(placeEndLabels で置く) */
interface LabeledEdge {
  id: string;
  /** リンクの線か(ブリッジとホストの間の線は選べない) */
  link: boolean;
  selected: boolean;
  line: LabeledLine;
  a?: EndText;
  b?: EndText;
}

/** 手で動かせるラベル */
interface Movable {
  key: string;
  line: LabeledLine;
  end: "a" | "b";
  /** クリックで選ぶリンク */
  link?: string;
}

/** 描くラベル */
interface EndLabelItem {
  id: string;
  at: Point;
  label: IfLabel;
  selected: boolean;
  move?: Movable;
}

/** ドラッグ中のラベル。押したときのラベルの中心と、ポインタの位置(フロー座標と画面の座標) */
interface Dragging {
  move: Movable;
  from: Point;
  start: Point;
  client: Point;
  /** 動かした位置(少し動かすまでは無い。クリックと区別する) */
  offset?: LabelOffset;
}

/** これより動かなければクリックとみなす(画面の px) */
const CLICK_SLOP = 3;

export function EndLabels() {
  const edges = useEdges<CanvasEdge>();
  // 機器が動いたら(ドラッグ中も)置き直す。位置は線と同じく、React Flow の中のノードから読む
  useNodes();
  const { getInternalNode, screenToFlowPosition } = useReactFlow<CanvasNode, CanvasEdge>();
  const view = useUi((s) => s.view);
  const mode = useUi((s) => s.mode);
  // 曲げる点をドラッグしている間も、端の区間に沿って置き直す(SPEC 7.3)
  const bendDrag = useUi((s) => s.bendDrag);
  const devices = useTopology((s) => s.topology.devices);
  const labelLayout = useTopology((s) => s.topology.labelLayout);
  const dragging = useRef<Dragging | undefined>(undefined);
  // ドラッグ中のラベルは、動かした位置に置いて、ほかのラベルも置き直す
  const [dragged, setDragged] = useState<{ key: string; offset: LabelOffset }>();

  const options = {
    showIfName: view.showIfLabels,
    longIfNames: view.longIfNames,
    showTransceiver: view.showTransceiver,
    showIp: view.showIp,
    showVlan: view.showVlan,
  };
  const labelEnd = (node: InternalNode<CanvasNode>, end: EndText | undefined): LabelEnd => ({
    node: node.id,
    center: iconCenter(node),
    text: end ? ifLabelLines(end.label) : [],
    // デバイス名はノードの幅で切れて表示される(Canvas.css)ので、それより広くはならない
    nameWidth:
      "label" in node.data
        ? Math.min(estimateNameWidth(node.data.label), DEVICE_NODE_WIDTH)
        : undefined,
    // ホストの名前の下の行(bond などの IP)も避ける
    details:
      view.showIp && "ipLines" in node.data ? nameDetails(node.data.ipLines ?? []) : undefined,
    offset: end && (dragged?.key === end.key ? dragged.offset : labelLayout.get(end.key)),
  });

  const labels: EndLabelItem[] = [];
  const labeled: LabeledEdge[] = [];
  for (const edge of edges) {
    const s = getInternalNode(edge.source);
    const t = getInternalNode(edge.target);
    // 隠したノード(ゲストなど)につながる線は、React Flow が描かない
    if (!s || !t || s.hidden || t.hidden) continue;
    const selected = edge.selected === true;
    if (edge.type === "link" && edge.data) {
      const { data } = edge;
      // ブリッジ側の端には IF 名を出さない(箱に名前があるため)
      const aLabel = data.aBridge
        ? undefined
        : ifLabel(data.aName, data.aInfo, options, data.aBond, data.aIps);
      const bLabel = data.bBridge
        ? undefined
        : ifLabel(data.bName, data.bInfo, options, data.bBond, data.bIps);
      if (edge.source === edge.target) {
        // 自分自身へのリンクの輪の上下(ほかの線のラベルとは比べない)
        const loop = selfLoop(iconCenter(s), data.slotIndex, data.label, {
          a: aLabel ? ifLabelLines(aLabel) : [],
          b: bLabel ? ifLabelLines(bLabel) : [],
        });
        if (aLabel) labels.push({ id: `${edge.id}:a`, at: loop.labelA, label: aLabel, selected });
        if (bLabel) labels.push({ id: `${edge.id}:b`, at: loop.labelB, label: bLabel, selected });
        continue;
      }
      const a = aLabel && { label: aLabel, key: labelKey(edge.source, data.aName) };
      const b = bLabel && { label: bLabel, key: labelKey(edge.target, data.bName) };
      labeled.push({
        id: edge.id,
        link: true,
        selected,
        line: {
          a: labelEnd(s, a),
          b: labelEnd(t, b),
          slot: { index: data.slotIndex, count: data.slotCount },
          // ずらす向きは ID の小さいデバイス → 大きいデバイスを基準にする(LinkEdge と同じ)
          reversed: edge.source > edge.target,
          via: orientBends(liveBends(data, s, t, bendDrag), edge.source, edge.target),
        },
        a,
        b,
      });
    } else if (edge.type === "uplink" && edge.data && !edge.data.vnet && view.showIfLabels) {
      // ホスト(target)側に、ブリッジの members を出す。VNet の箱からの線には出さない
      const device = devices.get(edge.target);
      const lines = device
        ? uplinkLabelLines(device, edge.data.bridge, (m) =>
            view.longIfNames ? expandIfName(m) : m,
          )
        : [];
      if (lines.length === 0) continue;
      const b = {
        label: { name: lines[0], details: lines.slice(1) },
        key: labelKey(edge.target, edge.data.bridge),
      };
      labeled.push({
        id: edge.id,
        link: false,
        selected,
        line: { a: labelEnd(s, undefined), b: labelEnd(t, b) },
        b,
      });
    }
  }
  const ends = placeEndLabels(labeled.map(({ line }) => line));
  labeled.forEach(({ id, link, selected, line, a, b }, i) => {
    for (const [end, text] of [
      ["a", a],
      ["b", b],
    ] as const) {
      if (!text) continue;
      labels.push({
        id: `${id}:${end}`,
        at: ends[i][end],
        label: text.label,
        selected,
        move: { key: text.key, line, end, link: link ? id : undefined },
      });
    }
  });

  const onPointerDown = (e: PointerEvent<HTMLDivElement>, item: EndLabelItem) => {
    if (!item.move || e.button !== 0) return;
    // 範囲選択やキャンバスの移動を始めない
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const client = { x: e.clientX, y: e.clientY };
    dragging.current = {
      move: item.move,
      from: item.at,
      start: screenToFlowPosition(client),
      client,
    };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragging.current;
    if (!d) return;
    const moved = Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y);
    if (!d.offset && moved < CLICK_SLOP) return;
    const now = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const at = { x: d.from.x + now.x - d.start.x, y: d.from.y + now.y - d.start.y };
    d.offset = endLabelOffset(d.move.line, d.move.end, at);
    setDragged({ key: d.move.key, offset: d.offset });
  };
  const onPointerUp = () => {
    const d = dragging.current;
    dragging.current = undefined;
    if (!d) return;
    if (d.offset) {
      topologyStore.getState().moveLabel(d.move.key, d.offset);
      setDragged(undefined);
    } else if (d.move.link !== undefined) {
      topologyStore.getState().setSelection({ devices: [], links: [d.move.link] });
    }
  };
  const onPointerCancel = () => {
    dragging.current = undefined;
    setDragged(undefined);
  };

  // 接続モードでは触れない(下の機器や線を触れるように)
  const movable = mode === "select";
  return (
    <EdgeLabelRenderer>
      {labels.map((item) => {
        const { id, at, label, selected, move } = item;
        const classes = [
          "link-if-label",
          selected && "selected",
          movable && move && "movable nodrag nopan",
          move && dragged?.key === move.key && "dragging",
        ];
        const handlers =
          movable && move
            ? {
                title: "ドラッグで動かす。ダブルクリックで自動の位置に戻す",
                onPointerDown: (e: PointerEvent<HTMLDivElement>) => onPointerDown(e, item),
                onPointerMove,
                onPointerUp,
                onPointerCancel,
                onDoubleClick: () => topologyStore.getState().resetLabels([move.key]),
              }
            : {};
        return (
          <Label key={id} at={at} className={classes.filter(Boolean).join(" ")} {...handlers}>
            {label.name !== undefined && <div>{label.name}</div>}
            {/* IF 名の下に、IP・VLAN を 1 行ずつ小さく出す */}
            {label.details.map((line, i) => (
              <div key={i} className="link-if-detail">
                {line}
              </div>
            ))}
          </Label>
        );
      })}
    </EdgeLabelRenderer>
  );
}
