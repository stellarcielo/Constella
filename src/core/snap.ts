// ドラッグ中のスナップ(SPEC 7.4)。動かしている点(機器のアイコンの中心や、曲げる点)を、ほかの点と縦・横で
// そろえる。そろったところには、ガイドの線を出す。グリッドを使うときは、そろう点が近くに無い向きを方眼に合わせる。

import type { Point } from "./linkGeometry";

/** ガイドの線(フロー座標) */
export interface Guide {
  from: Point;
  to: Point;
}

/** ガイドの線を、そろった点の外へはみ出させる長さ */
export const GUIDE_OVERHANG = 12;

/**
 * point を、targets のどれかと縦・横それぞれでそろえる。threshold より近いもののうち、いちばん近いものに合わせる。
 * そろえなかった向きは、grid(方眼の間隔)があれば方眼に合わせる。
 * ガイドは、そろった点どうしを結ぶ線(両端を GUIDE_OVERHANG はみ出す)。方眼に合わせただけなら出さない
 */
export function snapPoint(
  point: Point,
  targets: readonly Point[],
  threshold: number,
  grid?: number,
): { point: Point; guides: Guide[] } {
  const nearest = (axis: "x" | "y") => {
    let best: number | undefined;
    let distance = threshold;
    for (const t of targets) {
      const d = Math.abs(t[axis] - point[axis]);
      if (d < distance) {
        best = t[axis];
        distance = d;
      }
    }
    return best;
  };
  const toGrid = (value: number) => (grid ? Math.round(value / grid) * grid : value);
  const x = nearest("x");
  const y = nearest("y");
  const snapped = { x: x ?? toGrid(point.x), y: y ?? toGrid(point.y) };

  const guides: Guide[] = [];
  if (x !== undefined) {
    // 縦にそろった点を結ぶ縦の線
    const ys = [snapped.y, ...targets.filter((t) => t.x === x).map((t) => t.y)];
    guides.push({
      from: { x, y: Math.min(...ys) - GUIDE_OVERHANG },
      to: { x, y: Math.max(...ys) + GUIDE_OVERHANG },
    });
  }
  if (y !== undefined) {
    const xs = [snapped.x, ...targets.filter((t) => t.y === y).map((t) => t.x)];
    guides.push({
      from: { x: Math.min(...xs) - GUIDE_OVERHANG, y },
      to: { x: Math.max(...xs) + GUIDE_OVERHANG, y },
    });
  }
  return { point: snapped, guides };
}
