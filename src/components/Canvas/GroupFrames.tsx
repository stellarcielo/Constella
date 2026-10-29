// グループの枠(SPEC 4.3・フェーズ3-1)。メンバーの機器を囲む四角を、機器の今の位置から描く
// (ドラッグ中も追従する)。枠は線や機器より後ろ、ラベルは線より手前・機器より後ろに描き、
// ラベルのクリックでメンバーをまとめて選択する。ReactFlow の子として置く(フローの座標変換を使うため)。

import { EdgeLabelRenderer, useNodes, ViewportPortal } from "@xyflow/react";
import {
  type GroupFrame,
  groupFrames,
  groupKindFilter,
  groupTitle,
  type Position,
} from "../../core";
import { topologyStore, uiStore, useTopology, useUi } from "../../store";
import type { DeviceNodeType } from "./DeviceNode";

/** 枠のラベルをクリックしたら、メンバーをまとめて選択する(そのままドラッグで一緒に動かせる) */
function selectMembers(frame: GroupFrame): void {
  if (uiStore.getState().mode !== "select") return;
  topologyStore.getState().setSelection({ devices: frame.members, links: [] });
}

export function GroupFrames() {
  const topology = useTopology((s) => s.topology);
  const show = useUi((s) => s.view.showGroups);
  const kinds = useUi((s) => s.view.groupKinds);
  const nodes = useNodes<DeviceNodeType>();
  if (!show || topology.groups.length === 0) return null;

  // 機器の今の位置(ドラッグ中の位置も含む)。まだ並べていない(隠している)機器は除く
  const positions = new Map<string, Position>();
  for (const node of nodes) {
    if (!node.hidden) positions.set(node.id, node.position);
  }
  // 表示レイヤーで選んだ種類の枠だけを描く(フェーズ3-3)
  const frames = groupFrames(topology, (id) => positions.get(id), groupKindFilter(kinds));
  if (frames.length === 0) return null;
  const kindOf = (frame: GroupFrame) => `kind-${frame.group.kind ?? "none"}`;

  return (
    <>
      <ViewportPortal>
        <svg className="group-frames">
          {frames.map((frame) => (
            <rect
              key={frame.index}
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
            key={frame.index}
            className={`group-label ${kindOf(frame)} nodrag nopan`}
            style={{ transform: `translate(${frame.x + 8}px, ${frame.y + 4}px)` }}
            title="クリックでメンバーを選択"
            onClick={() => selectMembers(frame)}
          >
            {groupTitle(frame.group)}
          </div>
        ))}
      </EdgeLabelRenderer>
    </>
  );
}
