// 自動レイアウト(SPEC 9章)。elkjs の layered アルゴリズムで、上から下へ role の段に並べる。
// ゲストは、ホストと一緒にひとかたまり(elk の入れ子のノード)にして、ホストの下に並べる(SPEC 4.6)。

import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import { roundPosition } from "./edit";
import { DEVICE_BOX, GROUP_LABEL_BAND, GROUP_NEST_GAP, GROUP_PADDING } from "./groupFrames";
import { hostTree } from "./hosts";
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
  hypervisor: 4,
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

/** ホストの中の間隔(ゲストどうしの横の間と、ホストからゲストの段までの縦の間) */
const GUEST_SPACING = { x: 60, y: 80 };
/**
 * ホストの枠の上の部分(余白とラベルの帯)のうち、段と段の間(80)にはみ出してよい高さ。
 * ここまでは上の余白を取らないので、ホストが同じ段のほかの機器と同じ高さにそろう
 */
const FRAME_OVERHANG = 56;

/** ホストとゲストのかたまりの ID(デバイスID と重ならないように、YAML のキーには書けない文字で始める) */
const blockId = (host: string) => `\u0000${host}`;

const elk = new ELK();

/**
 * デバイスを並べた座標(左上)を返す。リンクは、並べるデバイスどうしのものだけを使う。
 * ゲストは、ホストも一緒に並べるときだけホストの下にまとめる。同じ入力なら同じ結果になる
 */
export async function computeLayout(
  t: Topology,
  catalog: ModelCatalog,
  options: LayoutOptions = {},
): Promise<Map<string, Position>> {
  const ids = options.devices ? new Set(options.devices) : new Set(t.devices.keys());
  const size = options.nodeSize ?? DEFAULT_NODE_SIZE;
  const tree = hostTree(t);
  /** 一緒に並べるホスト(ホストも並べるときだけ) */
  const hostOf = (id: string) => {
    const host = tree.hostOf.get(id);
    return host !== undefined && ids.has(host) ? host : undefined;
  };
  const guestsOf = (id: string) => (tree.guestsOf.get(id) ?? []).filter((g) => ids.has(g));
  /** いちばん外側のかたまりのホスト(かたまりに入らないデバイスは自分) */
  const outermost = (id: string) => {
    let current = id;
    for (let host = hostOf(current); host !== undefined; host = hostOf(current)) current = host;
    return current;
  };
  const nodeIdOf = (id: string) => (guestsOf(id).length > 0 ? blockId(id) : id);

  const leaf = (id: string, partition: number): ElkNode => ({
    id,
    ...size,
    layoutOptions: { "elk.partitioning.partition": String(partition) },
  });
  /** 内側にあるかたまりの段数(枠の入れ子の余白を取るため) */
  const depthOf = (id: string): number =>
    Math.max(-1, ...guestsOf(id).map((g) => (guestsOf(g).length > 0 ? depthOf(g) : -1))) + 1;
  /** ホストとゲストのかたまり。上の段にホスト、下の段にゲスト(YAML に書いた順) */
  const nodeOf = (id: string, partition: number): ElkNode => {
    const guests = guestsOf(id);
    if (guests.length === 0) return leaf(id, partition);
    // かたまりの余白は、ホストの枠(groupFrames)が収まる大きさにする
    const depth = depthOf(id);
    const pad = GROUP_PADDING + GROUP_NEST_GAP * depth;
    const top = Math.max(0, pad + GROUP_LABEL_BAND * (depth + 1) - FRAME_OVERHANG);
    const bottom = Math.max(0, pad - (size.height - DEVICE_BOX.height));
    return {
      id: blockId(id),
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.partitioning.activate": "true",
        "elk.partitioning.partition": String(partition),
        "elk.separateConnectedComponents": "false",
        "elk.spacing.nodeNode": String(GUEST_SPACING.x),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(GUEST_SPACING.y),
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        // ホストを、ゲストの段の真ん中に置く(ゲストが偶数台でも)
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
        "elk.padding": `[top=${top},left=${pad},bottom=${bottom},right=${pad}]`,
      },
      children: [leaf(id, 0), ...guests.map((g) => nodeOf(g, 1))],
      // ホストを、ゲストの段の中央寄りに置くための線(図には描かない)
      edges: guests.map((g, i) => ({
        id: `${blockId(id)}\u0000${i}`,
        sources: [id],
        targets: [nodeIdOf(g)],
      })),
    };
  };

  const tiers = new Map<string, number>();
  const children: ElkNode[] = [];
  for (const device of t.devices.values()) {
    if (!ids.has(device.id) || hostOf(device.id) !== undefined) continue;
    const tier = ROLE_TIER[resolveRole(device, catalog)];
    tiers.set(device.id, tier);
    children.push(nodeOf(device.id, tier));
  }
  if (children.length === 0) return new Map();

  // 並列リンクは 1 本、自分自身へのリンクは除く(並べ方には関係しない)。
  // 同じ段の機器どうしのリンク(HA・LAG など)も除く。あると ELK がその 2 台を別の段に分け、
  // 冗長化したペアが横に並ばなくなる(線はキャンバスで描くので消えない)。
  // かたまりの中の機器へのリンクは、かたまりにつなぐ(同じかたまりの中どうしのリンクは除く)
  const edges = new Map<string, ElkExtendedEdge>();
  for (const link of t.links) {
    const a = link.a?.device;
    const b = link.b?.device;
    if (!a || !b || !ids.has(a) || !ids.has(b)) continue;
    const [oa, ob] = [outermost(a), outermost(b)];
    const ta = tiers.get(oa);
    const tb = tiers.get(ob);
    if (oa === ob || ta === undefined || tb === undefined || ta === tb) continue;
    const key = oa < ob ? `${oa}\n${ob}` : `${ob}\n${oa}`;
    // 上の段から下の段への向きにする
    const [upper, lower] = ta < tb ? [oa, ob] : [ob, oa];
    if (!edges.has(key)) {
      edges.set(key, {
        id: `e${edges.size}`,
        sources: [nodeIdOf(upper)],
        targets: [nodeIdOf(lower)],
      });
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

  // かたまりの中の座標は、かたまりの左上からの位置なので、足し合わせて図の座標にする
  const positions = new Map<string, Position>();
  const collect = (node: ElkNode, ox: number, oy: number) => {
    const x = ox + (node.x ?? 0);
    const y = oy + (node.y ?? 0);
    if (node.children && node.children.length > 0) {
      for (const child of node.children) collect(child, x, y);
    } else {
      positions.set(node.id, roundPosition({ x, y }));
    }
  };
  for (const child of result.children ?? []) collect(child, 0, 0);
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
 * ホストの下に、新しいゲストを置く座標(count 台分。フェーズ4-1 Q1)。
 * ホストに座標のあるゲストがいれば、いちばん下の段の右に続け、いなければホストの下の段に、
 * ホストを中心にして並べる。座標のあるゲストは placed に渡す
 */
export function guestPositions(host: Position, placed: Position[], count: number): Position[] {
  const step = DEFAULT_NODE_SIZE.width + GUEST_SPACING.x;
  if (placed.length > 0) {
    const y = Math.max(...placed.map((p) => p.y));
    const right = Math.max(...placed.filter((p) => p.y === y).map((p) => p.x));
    return Array.from({ length: count }, (_, i) => roundPosition({ x: right + step * (i + 1), y }));
  }
  const left = host.x - (step * (count - 1)) / 2;
  const y = host.y + DEFAULT_NODE_SIZE.height + GUEST_SPACING.y;
  return Array.from({ length: count }, (_, i) => roundPosition({ x: left + step * i, y }));
}

/**
 * 座標の無いデバイスだけを並べる(SPEC 9章)。今ある座標は positionOf で渡す。
 * - ホストに座標があるゲストは、ホストの下に並べる(フェーズ4-1 Q1)
 * - 残りはまとめて並べ、今ある座標の下に置く。座標のあるデバイスが無ければ、並べた結果をそのまま返す
 */
export async function placeMissing(
  t: Topology,
  catalog: ModelCatalog,
  missing: Iterable<string>,
  positionOf: (id: string) => Position | undefined,
  options: Omit<LayoutOptions, "devices"> = {},
): Promise<Map<string, Position>> {
  const todo = new Set(missing);
  const placed = new Map<string, Position>();
  const at = (id: string) => placed.get(id) ?? (todo.has(id) ? undefined : positionOf(id));

  // 入れ子のゲストもあるので、置けるものが無くなるまでくり返す
  const tree = hostTree(t);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [host, guests] of tree.guestsOf) {
      const hostPos = at(host);
      const waiting = guests.filter((g) => todo.has(g) && !placed.has(g));
      if (!hostPos || waiting.length === 0) continue;
      const others = guests.flatMap((g) => {
        const pos = waiting.includes(g) ? undefined : at(g);
        return pos ? [pos] : [];
      });
      guestPositions(hostPos, others, waiting.length).forEach((pos, i) =>
        placed.set(waiting[i], pos),
      );
      progressed = true;
    }
  }

  const rest = [...todo].filter((id) => !placed.has(id));
  if (rest.length === 0) return placed;
  const laid = await computeLayout(t, catalog, { ...options, devices: rest });
  const existing = boundsOf(
    [...t.devices.keys()].flatMap((id) => {
      const pos = at(id);
      return pos ? [pos] : [];
    }),
  );
  const own = boundsOf(laid.values());
  if (!existing || !own) return new Map([...placed, ...laid]);
  const dx = existing.left - own.left;
  const dy = existing.bottom + BELOW_GAP - own.top;
  for (const [id, p] of laid) placed.set(id, roundPosition({ x: p.x + dx, y: p.y + dy }));
  return placed;
}
