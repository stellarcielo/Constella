// グループの枠(SPEC 4.3・フェーズ3-1)とホストの枠(SPEC 4.6・フェーズ4-1)。
// メンバーの機器を囲む四角を、機器の今の位置から描く(ドラッグ中も追従する)。
// 枠は線や機器より後ろ、ラベルは線より手前・機器より後ろに描き、ラベルのクリックでメンバーをまとめて選択する。
// ReactFlow の子として置く(フローの座標変換を使うため)。

import { EdgeLabelRenderer, useNodes, ViewportPortal } from "@xyflow/react";
import {
  type Frame,
  groupFrames,
  groupKindFilter,
  groupTitle,
  hostFrameTitle,
  type Position,
} from "../../core";
import { topologyStore, uiStore, useTopology, useUi } from "../../store";
import type { CanvasNode } from "./nodes";

/** 枠のラベルをクリックしたら、メンバーをまとめて選択する(そのままドラッグで一緒に動かせる) */
function selectMembers(frame: Frame): void {
  if (uiStore.getState().mode !== "select") return;
  topologyStore.getState().setSelection({ devices: frame.members, links: [] });
}

const keyOf = (frame: Frame) => (frame.type === "host" ? `host:${frame.host}` : frame.index);
const kindOf = (frame: Frame) =>
  `kind-${frame.type === "host" ? "host" : (frame.group.kind ?? "none")}`;

export function GroupFrames() {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const showGroups = useUi((s) => s.view.showGroups);
  const kinds = useUi((s) => s.view.groupKinds);
  const nodes = useNodes<CanvasNode>();

  // 機器とブリッジの今の位置(ドラッグ中の位置も含む)。まだ並べていない機器と、隠したゲストは除く
  const positions = new Map<string, Position>();
  for (const node of nodes) {
    if (!node.hidden) positions.set(node.id, node.position);
  }
  // グループの枠は「グループ」と表示レイヤーで選んだ種類だけ(フェーズ3-3)。
  // ホストの枠は、ゲストを表示しているときに描く(フェーズ4-1)
  const visible = showGroups ? groupKindFilter(kinds) : () => false;
  const frames = groupFrames(topology, (id) => positions.get(id), visible);
  if (frames.length === 0) return null;
  const titleOf = (frame: Frame) =>
    frame.type === "host" ? hostFrameTitle(topology, catalog, frame) : groupTitle(frame.group);

  return (
    <>
      <ViewportPortal>
        <svg className="group-frames">
          {frames.map((frame) => (
            <rect
              key={keyOf(frame)}
              className={`group-frame ${kindOf(frame)}`}
              x={frame.x}
              y={frame.y}
              width={frame.width}
              height={frame.height}
              rx={10}
            />
          ))}
        </svg>
      </ViewportPortal>
      {/* ラベルは背景を付けて線より手前に描く(上から機器に入る線が横切っても読めるように) */}
      <EdgeLabelRenderer>
        {frames.map((frame) => (
          <div
            key={keyOf(frame)}
            className={`group-label ${kindOf(frame)} nodrag nopan`}
            style={{ transform: `translate(${frame.x + 8}px, ${frame.y + 4}px)` }}
            title={
              frame.type === "host"
                ? `${frame.host} のゲスト。クリックでホストとゲストを選択`
                : "クリックでメンバーを選択"
            }
            onClick={() => selectMembers(frame)}
          >
            {titleOf(frame)}
          </div>
        ))}
      </EdgeLabelRenderer>
    </>
  );
}
