// 選んだリンクの、線を曲げるつまみ(SPEC 7.3)。曲げる点(四角)はドラッグで動かし、ダブルクリックで消す。
// 区間の真ん中の丸をドラッグすると、そこに曲げる点を足す。ドラッグ中は、隣の点(端なら機器の中心)と
// 水平・垂直に近ければそろえて、ガイドの線を出す(⌥ を押している間はそろえない)。
// ストアには、ドロップしたときに 1 回だけ書く。
// 同じ 2 台の間の線は同じ点を通るので、つまみは 2 台の組ごとに 1 組だけ出す。選択モードのときだけ出す。
// ReactFlow の子として置く(フローの座標変換と、ドラッグ中の位置を使うため)。

import { EdgeLabelRenderer, useEdges, useNodes, useReactFlow } from "@xyflow/react";
import { type CSSProperties, type PointerEvent, useRef } from "react";
import { midpoint, type Point, type Position, snapPoint } from "../../core";
import { topologyStore, uiStore, useUi } from "../../store";
import { iconCenter, liveBends } from "./geometry";
import type { CanvasEdge, CanvasNode } from "./nodes";

/** これより動かなければクリックとみなす(画面の px) */
const CLICK_SLOP = 3;
/** 隣の点とそろえる距離(画面の px) */
const SNAP = 8;
/** これより短い区間(画面の px)には、点を足す丸を出さない */
const MIN_SEGMENT = 28;

/** つまみを出す線(2 台の組ごと)。from・to は、キーの順の両端の中心 */
interface Route {
  key: string;
  from: Point;
  to: Point;
  points: Position[];
}

/** ドラッグ中のつまみ。押したときの線と、動かす点の番号(足すときは、足す場所) */
interface Dragging {
  route: Route;
  index: number;
  insert: boolean;
  client: Point;
  moved: boolean;
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
  const dragging = useRef<Dragging | undefined>(undefined);
  if (mode !== "select") return null;

  const routes = new Map<string, Route>();
  for (const edge of edges) {
    const key = edge.type === "link" ? edge.data?.bendKey : undefined;
    if (!edge.selected || edge.type !== "link" || !edge.data || key === undefined) continue;
    if (routes.has(key)) continue;
    const s = getInternalNode(edge.source);
    const t = getInternalNode(edge.target);
    if (!s || !t || s.hidden || t.hidden) continue;
    const [first, second] = edge.source < edge.target ? [s, t] : [t, s];
    routes.set(key, {
      key,
      from: iconCenter(first),
      to: iconCenter(second),
      points: liveBends(edge.data, s, t, drag),
    });
  }
  if (routes.size === 0) return null;

  const start = (e: PointerEvent<HTMLDivElement>, route: Route, index: number, insert: boolean) => {
    if (e.button !== 0) return;
    // 範囲選択やキャンバスの移動を始めない。リンクの選択も外さない
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = {
      route,
      index,
      insert,
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
    if (d.insert) points.splice(index, 0, now);
    // 隣の点(端なら機器の中心)と、水平・垂直にそろえる
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
              return (
                <div
                  key={`add-${j}`}
                  className="bend-handle add nodrag nopan"
                  style={at(midpoint(p, q))}
                  title="ドラッグして、線を曲げる点を足す"
                  onPointerDown={(e) => start(e, route, j, true)}
                  {...pointer}
                />
              );
            })}
            {route.points.map((p, i) => (
              <div
                key={`point-${i}`}
                className="bend-handle point nodrag nopan"
                style={at(p)}
                title="ドラッグで動かす。ダブルクリックで消す"
                onPointerDown={(e) => start(e, route, i, false)}
                onDoubleClick={() => remove(route, i)}
                {...pointer}
              />
            ))}
          </div>
        );
      })}
    </EdgeLabelRenderer>
  );
}
