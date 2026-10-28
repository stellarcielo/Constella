// 自動レイアウト(SPEC 9章)。elkjs の layered アルゴリズムで、上から下へ role の段に並べる。

import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { roundPosition } from "./edit";
import { resolveRole } from "./topology";
import type { ModelCatalog, Position, Role, Topology } from "./types";

/**
 * role ごとの段(上から 0)。段は固定する(フェーズ2-3 Q2)。
 * generic は中段(l2switch と同じ段)に置く(フェーズ2-3 Q3)
 */
export const ROLE_TIER: Record<Role, number> = {
  cloud: 0,
  router: 1,
  firewall: 1,
  l3switch: 2,
  l2switch: 3,
  generic: 3,
  server: 4,
  pc: 4,
  ap: 4,
};

export interface LayoutOptions {
  /** 並べるデバイス。省略すれば全部 */
  devices?: Iterable<string>;
  /** デバイス 1 台の大きさ(ラベルを含む) */
  nodeSize?: { width: number; height: number };
}

const DEFAULT_NODE_SIZE = { width: 96, height: 96 };

const elk = new ELK();

/**
 * デバイスを並べた座標(左上)を返す。リンクは、並べるデバイスどうしのものだけを使う。
 * 同じ入力なら同じ結果になる
 */
export async function computeLayout(
  t: Topology,
  catalog: ModelCatalog,
  options: LayoutOptions = {},
): Promise<Map<string, Position>> {
  const ids = options.devices ? new Set(options.devices) : new Set(t.devices.keys());
  const size = options.nodeSize ?? DEFAULT_NODE_SIZE;
  const tiers = new Map<string, number>();
  const children: ElkNode[] = [];
  for (const device of t.devices.values()) {
    if (!ids.has(device.id)) continue;
    const tier = ROLE_TIER[resolveRole(device, catalog)];
    tiers.set(device.id, tier);
    children.push({
      id: device.id,
      ...size,
      layoutOptions: { "elk.partitioning.partition": String(tier) },
    });
  }
  if (children.length === 0) return new Map();

  // 並列リンクは 1 本、自分自身へのリンクは除く(並べ方には関係しない)。
  // 同じ段の機器どうしのリンク(HA・LAG など)も除く。あると ELK がその 2 台を別の段に分け、
  // 冗長化したペアが横に並ばなくなる(線はキャンバスで描くので消えない)
  const edges = new Map<string, { id: string; sources: string[]; targets: string[] }>();
  for (const link of t.links) {
    const a = link.a?.device;
    const b = link.b?.device;
    if (!a || !b || a === b) continue;
    const ta = tiers.get(a);
    const tb = tiers.get(b);
    if (ta === undefined || tb === undefined || ta === tb) continue;
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`;
    // 上の段から下の段への向きにする
    const [upper, lower] = ta < tb ? [a, b] : [b, a];
    if (!edges.has(key)) {
      edges.set(key, { id: `e${edges.size}`, sources: [upper], targets: [lower] });
    }
  }

  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.partitioning.activate": "true",
      // つながっていない部分も同じ段にそろえる
      "elk.separateConnectedComponents": "false",
      // 横に並んだ機器どうしの線(HA・LAG など)の、両端の IF 名と中央のラベルが重ならない間隔
      "elk.spacing.nodeNode": "100",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      // 同じ段の中は、YAML に書いた順に左から並べる
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      // 上の段の機器を、下につながる機器の中央寄りに置く
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
    },
    children,
    edges: [...edges.values()],
  });

  const positions = new Map<string, Position>();
  for (const child of result.children ?? []) {
    positions.set(child.id, roundPosition({ x: child.x ?? 0, y: child.y ?? 0 }));
  }
  return positions;
}

/** 置いた座標の範囲(左上と右下)。無ければ undefined */
export function boundsOf(
  positions: Iterable<Position>,
): { left: number; top: number; bottom: number } | undefined {
  let bounds: { left: number; top: number; bottom: number } | undefined;
  for (const p of positions) {
    bounds = bounds
      ? {
          left: Math.min(bounds.left, p.x),
          top: Math.min(bounds.top, p.y),
          bottom: Math.max(bounds.bottom, p.y),
        }
      : { left: p.x, top: p.y, bottom: p.y };
  }
  return bounds;
}

/** 間を空けて、既にある座標の下に置くための縦の間隔 */
const BELOW_GAP = 180;

/**
 * 座標の無いデバイスだけを並べ、既にある座標(placed)の下にまとめて置く(SPEC 9章)。
 * placed が空なら、並べた結果をそのまま返す
 */
export async function placeMissing(
  t: Topology,
  catalog: ModelCatalog,
  missing: Iterable<string>,
  placed: Iterable<Position>,
  options: Omit<LayoutOptions, "devices"> = {},
): Promise<Map<string, Position>> {
  const laid = await computeLayout(t, catalog, { ...options, devices: missing });
  const existing = boundsOf(placed);
  const own = boundsOf(laid.values());
  if (!existing || !own) return laid;
  const dx = existing.left - own.left;
  const dy = existing.bottom + BELOW_GAP - own.top;
  return new Map([...laid].map(([id, p]) => [id, roundPosition({ x: p.x + dx, y: p.y + dy })]));
}
