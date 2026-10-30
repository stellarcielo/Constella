// ブリッジとホストの間の線(SPEC 7.3・フェーズ4-2 Q3)。YAML のリンクではなく、ブリッジの members から作る。
// 仮想のリンクと同じ点線で描き、ホスト側にブリッジの members(eno1・bond0 など)を出す。選んだり消したりはできない。

import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  useInternalNode,
} from "@xyflow/react";
import { endLabelPositions, estimateNameWidth, expandIfName } from "../../core";
import { useUi } from "../../store";
import { DEVICE_NODE_WIDTH, type DeviceNodeType } from "./DeviceNode";
import { iconCenter } from "./geometry";

export type UplinkEdgeData = {
  /** ブリッジの members(短い形の IF 名) */
  members: string[];
};

export type UplinkEdgeType = Edge<UplinkEdgeData, "uplink">;

export function UplinkEdge({ id, source, target, data }: EdgeProps<UplinkEdgeType>) {
  const bridge = useInternalNode(source);
  const host = useInternalNode<DeviceNodeType>(target);
  const showIfLabels = useUi((s) => s.view.showIfLabels);
  const longIfNames = useUi((s) => s.view.longIfNames);
  if (!bridge || !host || !data) return null;

  const from = iconCenter(bridge);
  const to = iconCenter(host);
  const text = data.members.map((m) => (longIfNames ? expandIfName(m) : m)).join(", ");
  const at = endLabelPositions(from, to, [], [text], undefined, {
    b: Math.min(estimateNameWidth(host.data.label), DEVICE_NODE_WIDTH),
  }).b;
  return (
    <>
      <BaseEdge id={id} path={`M ${from.x},${from.y} L ${to.x},${to.y}`} />
      {showIfLabels && (
        <EdgeLabelRenderer>
          <div
            className="link-if-label"
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
