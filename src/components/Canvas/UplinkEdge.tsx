// ブリッジとホストの間の線(SPEC 7.3・フェーズ4-2 Q3)。YAML のリンクではなく、ブリッジの members から作る。
// 仮想のリンクと同じ点線で描く。ホスト側のラベル(ブリッジの members。bond なら束ねた IF とモードも。
// フェーズ4-3 Q2)は、同じホストに付くほかの線のラベルと重ならないよう、EndLabels がまとめて置いて描く。
// 選んだり消したりはできない。
// VNet の箱からの線(ゾーンのブリッジの箱かホストへ。フェーズ4-6 Q2)には、ラベルを出さない。

import { BaseEdge, type Edge, type EdgeProps, useInternalNode } from "@xyflow/react";
import { iconCenter } from "./geometry";

export type UplinkEdgeData = {
  /** ブリッジの名前(ホストは線の target) */
  bridge: string;
  /** VNet の箱からの線(target はゾーンのブリッジの箱かホスト) */
  vnet?: boolean;
};

export type UplinkEdgeType = Edge<UplinkEdgeData, "uplink">;

export function UplinkEdge({ id, source, target }: EdgeProps<UplinkEdgeType>) {
  const bridge = useInternalNode(source);
  const host = useInternalNode(target);
  if (!bridge || !host) return null;

  const from = iconCenter(bridge);
  const to = iconCenter(host);
  return <BaseEdge id={id} path={`M ${from.x},${from.y} L ${to.x},${to.y}`} />;
}
