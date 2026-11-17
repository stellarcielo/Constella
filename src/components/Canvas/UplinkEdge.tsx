// ブリッジとホストの間の線(SPEC 7.3・フェーズ4-2 Q3)。YAML のリンクではなく、ブリッジの members から作る。
// 仮想のリンクと同じ点線で描く。ホスト側のラベル(ブリッジの members。bond なら束ねた IF とモードも。
// フェーズ4-3 Q2)は、同じホストに付くほかの線のラベルと重ならないよう、EndLabels がまとめて置いて描く。
// 選んだり消したりはできない。直角の線の図では、自動の道筋(routes.ts)にする。
// VNet の箱からの線(ゾーンのブリッジの箱かホストへ。フェーズ4-6 Q2)には、ラベルを出さない。

import { BaseEdge, type Edge, type EdgeProps, useInternalNode } from "@xyflow/react";
import { polylinePath } from "../../core";
import { iconCenter } from "./geometry";
import { useRoutes } from "./routes";

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
  const route = useRoutes()?.get(id);
  if (!bridge || !host) return null;

  const points = route?.points ?? [iconCenter(bridge), iconCenter(host)];
  return <BaseEdge id={id} path={polylinePath(points)} />;
}
