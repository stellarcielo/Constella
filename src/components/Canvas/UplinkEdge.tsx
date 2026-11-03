// ブリッジとホストの間の線(SPEC 7.3・フェーズ4-2 Q3)。YAML のリンクではなく、ブリッジの members から作る。
// 仮想のリンクと同じ点線で描き、ホスト側にブリッジの members(eno1・bond0 など)を出す。
// bond なら、その下に束ねた IF とモードを出す(フェーズ4-3 Q2)。選んだり消したりはできない。

import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  useInternalNode,
} from "@xyflow/react";
import {
  endLabelPositions,
  estimateNameWidth,
  expandIfName,
  nameDetails,
  uplinkLabelLines,
} from "../../core";
import { useTopology, useUi } from "../../store";
import { DEVICE_NODE_WIDTH, type DeviceNodeType } from "./DeviceNode";
import { iconCenter } from "./geometry";

export type UplinkEdgeData = {
  /** ブリッジの名前(ホストは線の target) */
  bridge: string;
};

export type UplinkEdgeType = Edge<UplinkEdgeData, "uplink">;

export function UplinkEdge({ id, source, target, data }: EdgeProps<UplinkEdgeType>) {
  const bridge = useInternalNode(source);
  const host = useInternalNode<DeviceNodeType>(target);
  const device = useTopology((s) => s.topology.devices.get(target));
  const showIfLabels = useUi((s) => s.view.showIfLabels);
  const longIfNames = useUi((s) => s.view.longIfNames);
  const showIp = useUi((s) => s.view.showIp);
  if (!bridge || !host || !data || !device) return null;

  const from = iconCenter(bridge);
  const to = iconCenter(host);
  const lines = uplinkLabelLines(device, data.bridge, (m) => (longIfNames ? expandIfName(m) : m));
  const at = endLabelPositions(
    from,
    to,
    [],
    lines,
    undefined,
    { b: Math.min(estimateNameWidth(host.data.label), DEVICE_NODE_WIDTH) },
    { b: showIp ? nameDetails(host.data.ipLines ?? []) : undefined },
  ).b;
  return (
    <>
      <BaseEdge id={id} path={`M ${from.x},${from.y} L ${to.x},${to.y}`} />
      {showIfLabels && lines.length > 0 && (
        <EdgeLabelRenderer>
          <div
            className="link-if-label"
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
          >
            <div>{lines[0]}</div>
            {lines.slice(1).map((line, i) => (
              <div key={i} className="link-if-detail">
                {line}
              </div>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
