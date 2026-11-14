// ドラッグ中のスナップ(SPEC 7.4)。動かしている点(機器のアイコンの中心や、曲げる点)を、ほかの点と縦・横で
// そろえる。そろったところには、ガイドの線を出す。グリッドを使うときは、そろう点が近くに無い向きを方眼に合わせる。
// 機器のドラッグでは、同じ行(列)に並ぶほかの点と等間隔になる位置にも吸い付かせ、等しい間隔にガイドを出す。

import type { Point } from "./linkGeometry";

/** ガイドの線(フロー座標)。spacing は等間隔を示す線(実線で描く) */
export interface Guide {
  from: Point;
  to: Point;
  spacing?: true;
}

/** ガイドの線を、そろった点の外へはみ出させる長さ */
export const GUIDE_OVERHANG = 12;

/** 等間隔のガイドの、両端の短い線の長さ */
export const SPACING_TICK = 8;

/** 等間隔にも吸い付かせるときの設定(機器のドラッグ) */
export interface SpacingOptions {
  /** 同じ行(列)とみなす、中心の縦(横)のずれ。これより小さければ同じ行 */
  band: number;
  /** 等間隔のガイドを引かない、点のまわりの長さ(アイコンのすき間に線を引くため) */
  inset: number;
}

type Axis = "x" | "y";
const cross = (axis: Axis): Axis => (axis === "x" ? "y" : "x");
/** 間隔が等しいとみなす差(保存する座標は整数なので、それより小さい差) */
const SAME_GAP = 0.5;

/** point と同じ行(axis が y なら同じ列)に並ぶ点の、axis の座標(重なりを除いて小さい順) */
function rowOf(point: Point, targets: readonly Point[], axis: Axis, band: number): number[] {
  const c = cross(axis);
  const values = targets.filter((t) => Math.abs(t[c] - point[c]) < band).map((t) => t[axis]);
  return [...new Set(values)].sort((a, b) => a - b);
}

/** 等間隔になる位置と、その間隔 */
interface Spacing {
  value: number;
  gap: number;
}

/**
 * axis の向きで、等間隔になる位置のうち threshold より近い、いちばん近いもの。
 * 両隣の 2 点の真ん中と、片側の隣の 2 点の間隔を延ばした位置を候補にする
 */
function nearestSpacing(
  value: number,
  row: readonly number[],
  threshold: number,
): (Spacing & { distance: number }) | undefined {
  const left = row.filter((v) => v < value).reverse();
  const right = row.filter((v) => v > value);
  const candidates: Spacing[] = [];
  if (left.length > 0 && right.length > 0) {
    candidates.push({ value: (left[0] + right[0]) / 2, gap: (right[0] - left[0]) / 2 });
  }
  if (left.length > 1) candidates.push({ value: left[0] * 2 - left[1], gap: left[0] - left[1] });
  if (right.length > 1) {
    candidates.push({ value: right[0] * 2 - right[1], gap: right[1] - right[0] });
  }
  let best: (Spacing & { distance: number }) | undefined;
  for (const c of candidates) {
    const distance = Math.abs(c.value - value);
    if (distance < (best?.distance ?? threshold)) best = { ...c, distance };
  }
  return best;
}

/**
 * 吸い付いた位置から、同じ間隔で続いている点の間ごとに、等間隔のガイドを作る。
 * 間隔ごとに、すき間の線と、その両端の短い線を引く(at は線を引く行・列の座標)
 */
function spacingGuides(
  { value, gap }: Spacing,
  row: readonly number[],
  axis: Axis,
  at: number,
  inset: number,
): Guide[] {
  const left = row.filter((v) => v < value).reverse();
  const right = row.filter((v) => v > value);
  const spans: [number, number][] = [];
  let prev = value;
  for (const v of left) {
    if (Math.abs(prev - v - gap) >= SAME_GAP) break;
    spans.push([v, prev]);
    prev = v;
  }
  prev = value;
  for (const v of right) {
    if (Math.abs(v - prev - gap) >= SAME_GAP) break;
    spans.push([prev, v]);
    prev = v;
  }
  const point = (along: number, side: number): Point =>
    axis === "x" ? { x: along, y: at + side } : { x: at + side, y: along };
  const tick = SPACING_TICK / 2;
  return spans.flatMap(([a, b]) => {
    // アイコンが重なるほど近ければ、中心から中心まで引く
    const i = b - a > inset * 2 ? inset : 0;
    return [
      { from: point(a + i, 0), to: point(b - i, 0), spacing: true },
      { from: point(a + i, -tick), to: point(a + i, tick), spacing: true },
      { from: point(b - i, -tick), to: point(b - i, tick), spacing: true },
    ];
  });
}

/**
 * point を、targets のどれかと縦・横それぞれでそろえる。threshold より近いもののうち、いちばん近いものに合わせる。
 * spacing を渡すと、同じ行(列)の点と等間隔になる位置も候補にし、そろえる位置より近ければそちらに合わせる
 * (同じ距離なら、そろえるほう)。
 * そろえなかった向きは、grid(方眼の間隔)があれば方眼に合わせる。
 * ガイドは、そろった点どうしを結ぶ線(両端を GUIDE_OVERHANG はみ出す)と、等しい間隔ごとの線。
 * 方眼に合わせただけなら出さない
 */
export function snapPoint(
  point: Point,
  targets: readonly Point[],
  threshold: number,
  grid?: number,
  spacing?: SpacingOptions,
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
  /** 等間隔の位置。そろえる位置(aligned)のほうが近いか同じなら使わない */
  const spaced = (axis: Axis, aligned: number | undefined) => {
    if (!spacing) return undefined;
    const row = rowOf(point, targets, axis, spacing.band);
    const found = nearestSpacing(point[axis], row, threshold);
    if (!found) return undefined;
    if (aligned !== undefined && Math.abs(aligned - point[axis]) <= found.distance)
      return undefined;
    return { spacing: { value: found.value, gap: found.gap }, row };
  };
  const alignedX = nearest("x");
  const alignedY = nearest("y");
  const spacedX = spaced("x", alignedX);
  const spacedY = spaced("y", alignedY);
  const x = spacedX ? undefined : alignedX;
  const y = spacedY ? undefined : alignedY;
  const snapped = {
    x: spacedX?.spacing.value ?? x ?? toGrid(point.x),
    y: spacedY?.spacing.value ?? y ?? toGrid(point.y),
  };

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
  const inset = spacing?.inset ?? 0;
  if (spacedX) guides.push(...spacingGuides(spacedX.spacing, spacedX.row, "x", snapped.y, inset));
  if (spacedY) guides.push(...spacingGuides(spacedY.spacing, spacedY.row, "y", snapped.x, inset));
  return { point: snapped, guides };
}
