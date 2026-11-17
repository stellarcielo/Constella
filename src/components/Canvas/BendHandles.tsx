// 選んだリンクの、線を曲げるつまみ(SPEC 7.3)。曲げる点(四角)はドラッグで動かし、ダブルクリックで消す。
// 区間の真ん中の丸をドラッグすると、そこに曲げる点を足す。ドラッグ中は、隣の点(端なら機器の中心)と
// 水平・垂直に近ければそろえて、ガイドの線を出す(⌥ を押している間はそろえない)。
// ストアには、ドロップしたときに 1 回だけ書く。
// 同じ 2 台の間の線は同じ点を通るので、つまみは 2 台の組ごとに 1 組だけ出す。選択モードのときだけ出す。
// 直角の線の図では、自動の道筋の角と区間につまみを出し、ドラッグすると、その形のまま手で曲げた線にする。
// 縦か横の区間の丸をドラッグすると、区間ごと横(縦)に動かす(両端の角が動き、直角のまま。端の区間は角だけ動く)。
// ReactFlow の子として置く(フローの座標変換と、ドラッグ中の位置を使うため)。

import { EdgeLabelRenderer, useEdges, useNodes, useReactFlow } from "@xyflow/react";
import { type CSSProperties, type PointerEvent, useRef } from "react";
import { attachEnds, midpoint, type Point, type Position, snapPoint } from "../../core";
import { topologyStore, uiStore, useUi } from "../../store";
import { iconCenter, liveBends } from "./geometry";
import type { CanvasEdge, CanvasNode } from "./nodes";
import { routeNodeOf, useRoutes } from "./routes";

/** これより動かなければクリックとみなす(画面の px) */
const CLICK_SLOP = 3;
/** 隣の点とそろえる距離(画面の px) */
const SNAP = 8;
/** これより短い区間(画面の px)には、点を足す丸を出さない */
const MIN_SEGMENT = 28;

/**
 * つまみを出す線(2 台の組ごと)。from・to は、キーの順の両端(まっすぐの線の図では中心、
 * 直角の線の図では描く線の端)。auto は直角の線の自動の道筋(points は、その角)
 */
interface Route {
  key: string;
  from: Point;
  to: Point;
  points: Position[];
  auto: boolean;
}

/**
 * ドラッグ中のつまみ。押したときの線と、動かす点の番号(足すとき・区間を動かすときは、区間の番号)。
 * axis は区間を動かすときに変える座標(縦の区間なら x)
 */
interface Dragging {
  route: Route;
  index: number;
  kind: "point" | "insert" | "segment";
  axis?: "x" | "y";
  client: Point;
  moved: boolean;
}

/** 直角の線の図で、区間 j を動かすときに変える座標。縦でも横でもない、または動かせる角が無ければ undefined */
function segmentAxis(route: Route, j: number): "x" | "y" | undefined {
  const all = [route.from, ...route.points, route.to];
  const p = all[j];
  const q = all[j + 1];
  // 両端とも線の端なら、動かせる角が無い
  if (j === 0 && route.points.length === 0) return undefined;
  if (Math.abs(p.x - q.x) < 0.5) return "x";
  if (Math.abs(p.y - q.y) < 0.5) return "y";
  return undefined;
}

const at = ({ x, y }: Point): CSSProperties => ({
  transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
});

export function BendHandles() {
  const edges = useEdges<CanvasEdge>();
  // 機器が動いたら(ドラッグ中も)置き直す
  useNodes();
  const { getInternalNode, screenToFlowPosition, getZoom } = useReactFlow<CanvasNode, CanvasEdge>();
  const mode = useUi((s) => s.mode);
  const drag = useUi((s) => s.bendDrag);
  const autoRoutes = useRoutes();
  const dragging = useRef<Dragging | undefined>(undefined);
  if (mode !== "select") return null;
  const orthogonal = autoRoutes !== undefined;

  const routes = new Map<string, Route>();
  for (const edge of edges) {
    const key = edge.type === "link" ? edge.data?.bendKey : undefined;
    if (!edge.selected || edge.type !== "link" || !edge.data || key === undefined) continue;
    if (routes.has(key)) continue;
    const s = getInternalNode(edge.source);
    const t = getInternalNode(edge.target);
    if (!s || !t || s.hidden || t.hidden) continue;
    const forward = edge.source < edge.target;
    const [first, second] = forward ? [s, t] : [t, s];
    const points = liveBends(edge.data, s, t, drag);
    const line = points.length === 0 ? autoRoutes?.get(edge.id)?.points : undefined;
    if (line) {
      // 自動の道筋の角(キーの順)
      const drawn = forward ? line : [...line].reverse();
      routes.set(key, {
        key,
        from: drawn[0],
        to: drawn[drawn.length - 1],
        points: drawn.slice(1, -1),
        auto: true,
      });
      continue;
    }
    // 直角の線の図では、端をアイコンからまっすぐ出した線(平行にずらす前)の端につまみを合わせる
    const ends = [iconCenter(first), ...points, iconCenter(second)];
    const drawn = orthogonal ? attachEnds(ends, routeNodeOf(first), routeNodeOf(second)) : ends;
    routes.set(key, {
      key,
      from: drawn[0],
      to: drawn[drawn.length - 1],
      points,
      auto: false,
    });
  }
  if (routes.size === 0) return null;

  const start = (
    e: PointerEvent<HTMLDivElement>,
    route: Route,
    index: number,
    kind: Dragging["kind"],
    axis?: "x" | "y",
  ) => {
    if (e.button !== 0) return;
    // 範囲選択やキャンバスの移動を始めない。リンクの選択も外さない
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = {
      route,
      index,
      kind,
      axis,
      client: { x: e.clientX, y: e.clientY },
      moved: false,
    };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragging.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y) < CLICK_SLOP) {
      return;
    }
    d.moved = true;
    const { route, index } = d;
    const now = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const points = [...route.points];
    if (d.kind === "segment") {
      // 区間の両端の角(線の端は動かさない)を、横(縦)にだけ動かす
      for (const i of [index - 1, index]) {
        const p = points[i];
        if (!p) continue;
        points[i] = d.axis === "x" ? { x: now.x, y: p.y } : { x: p.x, y: now.y };
      }
      uiStore.getState().setBendDrag({ key: route.key, points });
      return;
    }
    if (d.kind === "insert") points.splice(index, 0, now);
    // 隣の点(端なら線の端。まっすぐの線の図では機器の中心)と、水平・垂直にそろえる
    const all = [route.from, ...points, route.to];
    const snapped = e.altKey
      ? { point: now, guides: [] }
      : snapPoint(now, [all[index], all[index + 2]], SNAP / getZoom());
    points[index] = snapped.point;
    uiStore.getState().setBendDrag({ key: route.key, points });
    uiStore.getState().setGuides(snapped.guides);
  };
  const end = () => {
    const d = dragging.current;
    dragging.current = undefined;
    uiStore.getState().setGuides([]);
    if (!d?.moved) return;
    const dragged = uiStore.getState().bendDrag;
    if (dragged?.key === d.route.key)
      topologyStore.getState().setBends(dragged.key, dragged.points);
    uiStore.getState().setBendDrag(undefined);
  };
  const cancel = () => {
    dragging.current = undefined;
    uiStore.getState().setBendDrag(undefined);
    uiStore.getState().setGuides([]);
  };
  const remove = (route: Route, index: number) =>
    topologyStore.getState().setBends(
      route.key,
      route.points.filter((_, i) => i !== index),
    );
  const pointer = { onPointerMove: move, onPointerUp: end, onPointerCancel: cancel };

  const zoom = getZoom();
  return (
    <EdgeLabelRenderer>
      {[...routes.values()].map((route) => {
        const all = [route.from, ...route.points, route.to];
        return (
          <div key={route.key}>
            {all.slice(1).map((q, j) => {
              const p = all[j];
              if (Math.hypot(q.x - p.x, q.y - p.y) * zoom < MIN_SEGMENT) return null;
              const axis = orthogonal ? segmentAxis(route, j) : undefined;
              return (
                <div
                  key={`add-${j}`}
                  className="bend-handle add nodrag nopan"
                  style={at(midpoint(p, q))}
                  title={
                    axis ? "ドラッグして、線の区間を動かす" : "ドラッグして、線を曲げる点を足す"
                  }
                  onPointerDown={(e) => start(e, route, j, axis ? "segment" : "insert", axis)}
                  {...pointer}
                />
              );
            })}
            {route.points.map((p, i) => (
              <div
                key={`point-${i}`}
                className="bend-handle point nodrag nopan"
                style={at(p)}
                title={
                  route.auto
                    ? "ドラッグで動かす(手で曲げた線になります)"
                    : "ドラッグで動かす。ダブルクリックで消す"
                }
                onPointerDown={(e) => start(e, route, i, "point")}
                onDoubleClick={route.auto ? undefined : () => remove(route, i)}
                {...pointer}
              />
            ))}
          </div>
        );
      })}
    </EdgeLabelRenderer>
  );
}
