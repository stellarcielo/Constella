// 直角の線(SPEC 7.3)の道筋。キャンバスの全部の線をまとめて決め、LinkEdge・UplinkEdge・EndLabels・BendHandles で
// 同じ結果を使う(React Flow のノードと線が変わるまで、計算は 1 回だけ)。
// 線と、ノードの大きさの見積もりは、SVG の書き出し(render.ts)と同じにする。

import { type InternalNode, type ReactFlowState, useStoreApi } from "@xyflow/react";
import { useSyncExternalStore } from "react";
import {
  attachEnds,
  bridgeRouteNode,
  deviceRouteNode,
  linkPoints,
  nameDetails,
  type OrthogonalRoute,
  orientBends,
  orthogonalRoutes,
  type Point,
  type Position,
  type RouteLine,
  type RouteNode,
  type Slot,
  slotOffset,
} from "../../core";
import { useTopology, useUi } from "../../store";
import { iconCenter } from "./geometry";
import type { LinkEdgeData } from "./LinkEdge";
import type { CanvasEdge, CanvasNode } from "./nodes";

export type Routes = ReadonlyMap<string, OrthogonalRoute>;

/** ノードの大きさに効く表示オプション(デバイス名・ブリッジの箱の下の行) */
interface Display {
  showIp: boolean;
  showVlan: boolean;
}

const NO_LINES: Display = { showIp: false, showVlan: false };

/** 道筋を決めるときのノードの大きさ(render.ts と同じ見積もり) */
export function routeNodeOf(node: InternalNode<CanvasNode>, display = NO_LINES): RouteNode {
  const center = iconCenter(node);
  const { data } = node;
  // ブリッジの箱のデータには ip がある(デバイスには無い)
  if ("ip" in data) {
    const lines =
      (display.showVlan && data.vnet?.tag ? 1 : 0) + (display.showIp ? data.ip.length : 0);
    return bridgeRouteNode(center, lines);
  }
  return deviceRouteNode(center, display.showIp ? nameDetails(data.ipLines ?? []) : undefined);
}

/** 最後に求めた道筋(同じノード・線・表示オプションなら、それを返す) */
let cache:
  { nodes: CanvasNode[]; edges: CanvasEdge[]; display: Display; routes: Routes } | undefined;

function routesOf(s: ReactFlowState<CanvasNode, CanvasEdge>, display: Display): Routes {
  if (
    cache &&
    cache.nodes === s.nodes &&
    cache.edges === s.edges &&
    cache.display.showIp === display.showIp &&
    cache.display.showVlan === display.showVlan
  ) {
    return cache.routes;
  }
  const nodes = new Map<string, RouteNode>();
  const nodeOf = (id: string) => {
    if (!nodes.has(id)) {
      const node = s.nodeLookup.get(id);
      // 隠したノード(ゲストなど)につながる線は描かない
      if (node && !node.hidden) nodes.set(id, routeNodeOf(node, display));
    }
    return nodes.get(id);
  };
  const lines: RouteLine[] = [];
  for (const edge of s.edges) {
    // 自分自身へのリンクの輪と、手で曲げた線は、自動の道筋にしない
    if (edge.source === edge.target) continue;
    if (edge.type === "link" && (edge.data?.bends.length ?? 0) > 0) continue;
    if (!nodeOf(edge.source) || !nodeOf(edge.target)) continue;
    lines.push({ id: edge.id, a: edge.source, b: edge.target });
  }
  const routes = orthogonalRoutes(lines, nodes);
  cache = { nodes: s.nodes, edges: s.edges, display, routes };
  return routes;
}

/** 直角の線の道筋(キー = 線の ID)。まっすぐの線の図なら undefined */
export function useRoutes(): Routes | undefined {
  const store = useStoreApi<CanvasNode, CanvasEdge>();
  const orthogonal = useTopology((s) => s.topology.routing === "orthogonal");
  const showIp = useUi((s) => s.view.showIp);
  const showVlan = useUi((s) => s.view.showVlan);
  return useSyncExternalStore(store.subscribe, () =>
    orthogonal ? routesOf(store.getState(), { showIp, showVlan }) : undefined,
  );
}

/**
 * リンクの線の点(source から target の順)。直角の線の図では、曲げていない線は自動の道筋(ends も返す)、
 * 曲げた線は端をアイコンからまっすぐ出したもの。bends は今の曲げる点(キーの順。liveBends)
 */
export function linkLine(
  edge: { id: string; source: string; target: string; data: LinkEdgeData },
  s: InternalNode<CanvasNode>,
  t: InternalNode<CanvasNode>,
  bends: readonly Position[],
  routes: Routes | undefined,
): { points: Point[]; ends?: { a: Slot; b: Slot } } {
  const route = bends.length === 0 ? routes?.get(edge.id) : undefined;
  if (route) return route;
  const { source, target, data } = edge;
  const slot = { index: data.slotIndex, count: data.slotCount };
  // ずらす向きは ID の小さいデバイス → 大きいデバイスを基準にする(IF 名ラベルを分ける向きも同じ)
  const points = linkPoints(
    iconCenter(s),
    iconCenter(t),
    orientBends(bends, source, target),
    slotOffset(slot),
    source > target,
  );
  return { points: routes ? attachEnds(points, routeNodeOf(s), routeNodeOf(t)) : points };
}
