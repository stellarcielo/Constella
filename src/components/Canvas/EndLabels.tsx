// リンク両端の IF 名ラベル(SPEC 7.3)。線ごとではなく、全部の線のラベルをここでまとめて置いて描く
// (同じデバイスに付く、別々の線のラベルを重ねないため。placeEndLabels)。
// ブリッジとホストの間の線のホスト側のラベル(ブリッジの members。bond なら束ねた IF とモードも。
// フェーズ4-2 Q3・4-3 Q2)と、自分自身へのリンクの輪のラベルもここで描く。線は LinkEdge・UplinkEdge が描く。
// ReactFlow の子として置く(フローの座標変換と、ドラッグ中の位置を使うため)。

import {
  EdgeLabelRenderer,
  type InternalNode,
  useEdges,
  useNodes,
  useReactFlow,
} from "@xyflow/react";
import {
  estimateNameWidth,
  expandIfName,
  type IfLabel,
  ifLabel,
  ifLabelLines,
  type LabeledLine,
  type LabelEnd,
  nameDetails,
  placeEndLabels,
  type Point,
  selfLoop,
  uplinkLabelLines,
} from "../../core";
import { useTopology, useUi } from "../../store";
import { DEVICE_NODE_WIDTH } from "./DeviceNode";
import { iconCenter } from "./geometry";
import { Label } from "./LinkEdge";
import type { CanvasEdge, CanvasNode } from "./nodes";

/** 線のラベル(placeEndLabels で置く) */
interface LabeledEdge {
  id: string;
  selected: boolean;
  line: LabeledLine;
  a?: IfLabel;
  b?: IfLabel;
}

export function EndLabels() {
  const edges = useEdges<CanvasEdge>();
  // 機器が動いたら(ドラッグ中も)置き直す。位置は線と同じく、React Flow の中のノードから読む
  useNodes();
  const { getInternalNode } = useReactFlow<CanvasNode, CanvasEdge>();
  const view = useUi((s) => s.view);
  const devices = useTopology((s) => s.topology.devices);

  const options = {
    showIfName: view.showIfLabels,
    longIfNames: view.longIfNames,
    showIp: view.showIp,
    showVlan: view.showVlan,
  };
  const labelEnd = (node: InternalNode<CanvasNode>, label: IfLabel | undefined): LabelEnd => ({
    node: node.id,
    center: iconCenter(node),
    text: label ? ifLabelLines(label) : [],
    // デバイス名はノードの幅で切れて表示される(Canvas.css)ので、それより広くはならない
    nameWidth:
      "label" in node.data
        ? Math.min(estimateNameWidth(node.data.label), DEVICE_NODE_WIDTH)
        : undefined,
    // ホストの名前の下の行(bond などの IP)も避ける
    details:
      view.showIp && "ipLines" in node.data ? nameDetails(node.data.ipLines ?? []) : undefined,
  });

  const labels: { key: string; at: Point; label: IfLabel; selected: boolean }[] = [];
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
      const a = data.aBridge
        ? undefined
        : ifLabel(data.aName, data.aInfo, options, data.aBond, data.aIps);
      const b = data.bBridge
        ? undefined
        : ifLabel(data.bName, data.bInfo, options, data.bBond, data.bIps);
      if (edge.source === edge.target) {
        // 自分自身へのリンクの輪の上下(ほかの線のラベルとは比べない)
        const loop = selfLoop(iconCenter(s), data.slotIndex, data.label, {
          a: a ? ifLabelLines(a) : [],
          b: b ? ifLabelLines(b) : [],
        });
        if (a) labels.push({ key: `${edge.id}:a`, at: loop.labelA, label: a, selected });
        if (b) labels.push({ key: `${edge.id}:b`, at: loop.labelB, label: b, selected });
        continue;
      }
      labeled.push({
        id: edge.id,
        selected,
        line: {
          a: labelEnd(s, a),
          b: labelEnd(t, b),
          slot: { index: data.slotIndex, count: data.slotCount },
          // ずらす向きは ID の小さいデバイス → 大きいデバイスを基準にする(LinkEdge と同じ)
          reversed: edge.source > edge.target,
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
      const b = { name: lines[0], details: lines.slice(1) };
      labeled.push({
        id: edge.id,
        selected,
        line: { a: labelEnd(s, undefined), b: labelEnd(t, b) },
        b,
      });
    }
  }
  const ends = placeEndLabels(labeled.map(({ line }) => line));
  labeled.forEach(({ id, selected, a, b }, i) => {
    if (a) labels.push({ key: `${id}:a`, at: ends[i].a, label: a, selected });
    if (b) labels.push({ key: `${id}:b`, at: ends[i].b, label: b, selected });
  });

  return (
    <EdgeLabelRenderer>
      {labels.map(({ key, at, label, selected }) => (
        <Label key={key} at={at} className={`link-if-label${selected ? " selected" : ""}`}>
          {label.name !== undefined && <div>{label.name}</div>}
          {/* IF 名の下に、IP・VLAN を 1 行ずつ小さく出す */}
          {label.details.map((line, i) => (
            <div key={i} className="link-if-detail">
              {line}
            </div>
          ))}
        </Label>
      ))}
    </EdgeLabelRenderer>
  );
}
