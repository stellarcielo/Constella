// ドラッグ中のガイドの線(SPEC 7.4)。機器や曲げる点が、ほかの機器や点とそろったところに点線を引き、
// 機器が等間隔になったところには、間隔ごとに実線を引く。
// 線の太さと点線の間隔は、拡大しても画面の上で同じになるようにする。ReactFlow の子として置く。

import { useStore, ViewportPortal } from "@xyflow/react";
import { useUi } from "../../store";

export function SnapGuides() {
  const guides = useUi((s) => s.guides);
  const zoom = useStore((s) => s.transform[2]);
  if (guides.length === 0) return null;
  return (
    <ViewportPortal>
      <svg className="snap-guides" width={1} height={1}>
        {guides.map((g, i) => (
          <line
            key={i}
            x1={g.from.x}
            y1={g.from.y}
            x2={g.to.x}
            y2={g.to.y}
            strokeWidth={1 / zoom}
            strokeDasharray={g.spacing ? undefined : `${4 / zoom} ${3 / zoom}`}
          />
        ))}
      </svg>
    </ViewportPortal>
  );
}
