// トポロジを SVG の文字列にする(SVG / PNG の書き出し。将来の CLI の `constella render` でも使う)。
// 見た目はキャンバスに合わせ、ライトテーマ・白背景で描く(フェーズ2-4 Q2)。選択や問題の印は描かない。

import { allBridges, BRIDGE_BOX, endpointNodeId, parseBridgeKey } from "./bridges";
import { groupFrames, groupKindFilter, groupTitle, hostFrameTitle } from "./groupFrames";
import { resolveGuest } from "./hosts";
import { ROLE_ICON_SVG, ROLE_ICON_VIEWBOX } from "./icons";
import { type IfLabel, ifLabel, ifLabelLines, interfaceInfo } from "./ifLabel";
import { expandIfName } from "./ifname";
import {
  endLabelPositions,
  estimateLabelSize,
  estimateNameWidth,
  midpoint,
  offsetLine,
  parallelSlots,
  type Point,
  selfLoop,
  slotOffset,
} from "./linkGeometry";
import { linkMedia } from "./media";
import { resolveLabel, resolveRole } from "./topology";
import type {
  GroupKind,
  GuestKind,
  InterfaceInfo,
  Media,
  ModelCatalog,
  Position,
  Role,
  Topology,
} from "./types";

export interface RenderOptions {
  /** layout に座標の無いデバイスの位置(キャンバスの自動配置。キー = デバイスID) */
  fallbackPositions?: ReadonlyMap<string, Position>;
  /** リンク両端の IF 名を描くか(ツールバーの「IF 名」) */
  showIfLabels?: boolean;
  /** IF 名を長い形で描くか(ツールバーの「長い名前」) */
  longIfNames?: boolean;
  /** IF 名の下に IP を描くか(ツールバーの「IP」) */
  showIp?: boolean;
  /** IF 名の下に VLAN を描くか(ツールバーの「VLAN」) */
  showVlan?: boolean;
  /** グループの枠を描くか(ツールバーの「グループ」) */
  showGroups?: boolean;
  /** 枠を描くグループの種類(表示レイヤー。省略すればすべて。種類なし・custom はいつも描く) */
  groupKinds?: readonly GroupKind[];
  /** ゲスト(VM・コンテナ)とホストの枠を描くか(ツールバーの「ゲスト」) */
  showGuests?: boolean;
  /** 図のまわりの余白 */
  padding?: number;
}

export interface RenderedSvg {
  svg: string;
  width: number;
  height: number;
}

/** 書き出しの色(App.css のライトテーマと合わせる) */
const THEME = {
  background: "#ffffff",
  panel: "#f6f7f9",
  border: "#d9dce1",
  text: "#1f2328",
  textMuted: "#646b75",
  labelBg: "#ffffff",
  labelBgOpacity: 0.92,
};

const ROLE_COLORS: Record<Role, string> = {
  cloud: "#6e7781",
  router: "#2f6fde",
  firewall: "#cf3d2e",
  l3switch: "#8250df",
  l2switch: "#1a7f37",
  server: "#bf5b00",
  hypervisor: "#6b7f00",
  pc: "#0a7d8c",
  ap: "#b3368f",
  generic: "#57606a",
};

/** media ごとの線の色と種類(Canvas.css と合わせる) */
const MEDIA_STYLES: Record<Media, string> = {
  copper: 'stroke="#8c959f"',
  fiber: 'stroke="#e8822a"',
  dac: 'stroke="#3d7be0"',
  wireless: 'stroke="#8c959f" stroke-dasharray="8 5"',
  virtual: 'stroke="#8c959f" stroke-dasharray="2 4" stroke-linecap="round"',
};

/**
 * グループの種類ごとの枠の見た目(Canvas.css と合わせる。フェーズ3-1 Q2)。
 * 拠点は太い実線、ラックは実線、VLAN は破線、サブネットは点線、AS は一点鎖線、種類なしは細い実線
 */
const GROUP_STYLES: Record<GroupKind | "none", string> = {
  site: 'stroke="#57606a" stroke-width="2.5" fill="#f6f8fa"',
  rack: 'stroke="#8c959f" stroke-width="1.5" fill="#eef1f4" fill-opacity="0.7"',
  vlan: 'stroke="#8250df" stroke-width="1.5" stroke-dasharray="8 5" fill="#8250df" fill-opacity="0.05"',
  subnet:
    'stroke="#1a7f37" stroke-width="1.5" stroke-dasharray="1 4" stroke-linecap="round" fill="#1a7f37" fill-opacity="0.05"',
  as: 'stroke="#bc4c00" stroke-width="1.5" stroke-dasharray="10 4 2 4" fill="#bc4c00" fill-opacity="0.05"',
  custom: 'stroke="#8c959f" stroke-width="1" fill="none"',
  none: 'stroke="#8c959f" stroke-width="1" fill="none"',
};

/** ホストの枠(Canvas.css と合わせる) */
const HOST_FRAME_STYLE = 'stroke="#6b7f00" stroke-width="1.5" fill="#6b7f00" fill-opacity="0.05"';
const HOST_FRAME_TEXT_COLOR = "#6b7f00";

/** ゲストの印(アイコンの右上に重ねる。Canvas.css の .device-guest-badge と合わせる) */
const GUEST_BADGE_TEXT: Record<GuestKind, string> = { vm: "VM", container: "CT" };

const GROUP_TEXT_COLORS: Record<GroupKind | "none", string> = {
  site: "#424a53",
  rack: "#57606a",
  vlan: "#8250df",
  subnet: "#1a7f37",
  as: "#bc4c00",
  custom: "#57606a",
  none: "#57606a",
};

const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Segoe UI", sans-serif';
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// デバイスの大きさ(Canvas.css の .device-node と合わせる)。座標はノードの左上
const NODE_WIDTH = 96;
const ICON_BOX = 52;
const ICON_SIZE = 34;
const NAME_TOP = ICON_BOX + 4;
const NAME_HEIGHT = 18;
const NAME_FONT = 12;

/** 小さな印(ゲストの VM / CT、ブリッジの VLAN)。箱の右上の角(right, top)に重ねる */
function badge(right: number, top: number, text: string, bounds: Bounds): string {
  const width = Math.max(20, 8 + text.length * 6);
  const height = 13;
  const x = right - width + 9;
  const y = top - 6;
  bounds.add(x, y, x + width, y + height);
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${width}" height="${height}" rx="4" ` +
    `fill="${THEME.labelBg}" stroke="${THEME.border}"/>` +
    `<text x="${n(x + width / 2)}" y="${n(y + height / 2 + 9 * 0.35)}" text-anchor="middle" ` +
    `font-family="${escapeXml(FONT)}" font-size="9" font-weight="700" fill="${THEME.textMuted}">${text}</text>`
  );
}

/** ノードの左上の座標から、アイコンの中心へ(キャンバスのリンクの端と同じ点) */
function iconCenter(p: Position): Point {
  return { x: p.x + NODE_WIDTH / 2, y: p.y + ICON_BOX / 2 };
}

/** ブリッジの箱の中心(キャンバスと同じ点) */
function bridgeCenter(p: Position): Point {
  return { x: p.x + NODE_WIDTH / 2, y: p.y + BRIDGE_BOX.height / 2 };
}

/** ブリッジの箱。名前を中に、VLAN aware の印を右上に、IP を下に描く(Canvas.css の .bridge-node と合わせる) */
function bridgeSvg(
  name: string,
  info: InterfaceInfo | undefined,
  pos: Position,
  showIp: boolean,
  bounds: Bounds,
): string {
  const x = pos.x + (NODE_WIDTH - BRIDGE_BOX.width) / 2;
  const center = bridgeCenter(pos);
  bounds.add(x, pos.y, x + BRIDGE_BOX.width, pos.y + BRIDGE_BOX.height);
  const ips = showIp ? (info?.ip ?? []) : [];
  return (
    `<g>` +
    `<rect x="${n(x)}" y="${n(pos.y)}" width="${BRIDGE_BOX.width}" height="${BRIDGE_BOX.height}" rx="6" ` +
    `fill="${THEME.panel}" stroke="${HOST_FRAME_TEXT_COLOR}" stroke-width="1.5"/>` +
    `<text x="${n(center.x)}" y="${n(center.y + 11 * 0.35)}" text-anchor="middle" ` +
    `font-family="${escapeXml(MONO_FONT)}" font-size="11" fill="${THEME.text}">${escapeXml(name)}</text>` +
    (info?.vlanAware ? badge(x + BRIDGE_BOX.width, pos.y, "VLAN", bounds) : "") +
    ips
      .map((ip, i) =>
        label(
          { x: center.x, y: pos.y + BRIDGE_BOX.height + 9 + i * 14 },
          ip,
          { width: estimateLabelSize(ip).width, height: 14 },
          { font: MONO_FONT, fontSize: 10, color: THEME.textMuted, border: false },
          bounds,
        ),
      )
      .join("") +
    `</g>`
  );
}

/** SVG の文字や属性に入れるため、特別な意味のある文字を置き換える */
export function escapeXml(text: string): string {
  return text
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;");
}

const n = (v: number) => String(Math.round(v * 10) / 10);

/** 描いたものの範囲 */
class Bounds {
  left = Infinity;
  top = Infinity;
  right = -Infinity;
  bottom = -Infinity;

  add(x0: number, y0: number, x1: number, y1: number): void {
    this.left = Math.min(this.left, x0);
    this.top = Math.min(this.top, y0);
    this.right = Math.max(this.right, x1);
    this.bottom = Math.max(this.bottom, y1);
  }

  get empty(): boolean {
    return this.left > this.right;
  }
}

/** 背景付きのラベル(中心が at) */
function label(
  at: Point,
  text: string,
  size: { width: number; height: number },
  style: { font: string; fontSize: number; color: string; border: boolean; bold?: boolean },
  bounds: Bounds,
): string {
  const x = at.x - size.width / 2;
  const y = at.y - size.height / 2;
  bounds.add(x, y, x + size.width, y + size.height);
  const border = style.border ? ` stroke="${THEME.border}"` : "";
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(size.width)}" height="${n(size.height)}" rx="3" ` +
    `fill="${THEME.labelBg}" fill-opacity="${THEME.labelBgOpacity}"${border}/>` +
    `<text x="${n(at.x)}" y="${n(at.y + style.fontSize * 0.35)}" text-anchor="middle" ` +
    `font-family="${escapeXml(style.font)}" font-size="${style.fontSize}"` +
    `${style.bold ? ' font-weight="600"' : ""} fill="${style.color}">${escapeXml(text)}</text>`
  );
}

/** IF 名ラベル。IF 名の下に IP・VLAN を 1 行ずつ、薄い色で描く(キャンバスと同じ形) */
function ifLabelSvg(at: Point, ifLabelValue: IfLabel, bounds: Bounds): string {
  const lines = ifLabelLines(ifLabelValue);
  const size = estimateLabelSize(lines);
  const x = at.x - size.width / 2;
  const y = at.y - size.height / 2;
  bounds.add(x, y, x + size.width, y + size.height);
  const lineHeight = (size.height - 2) / lines.length;
  const text = lines
    .map((line, i) => {
      const muted = ifLabelValue.name === undefined || i > 0;
      const baseline = y + 1 + lineHeight * (i + 0.5) + 10 * 0.35;
      return (
        `<text x="${n(at.x)}" y="${n(baseline)}" text-anchor="middle" ` +
        `font-family="${escapeXml(MONO_FONT)}" font-size="10" ` +
        `fill="${muted ? THEME.textMuted : THEME.text}">${escapeXml(line)}</text>`
      );
    })
    .join("");
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(size.width)}" height="${n(size.height)}" rx="3" ` +
    `fill="${THEME.labelBg}" fill-opacity="${THEME.labelBgOpacity}" stroke="${THEME.border}"/>` +
    text
  );
}

/**
 * 図全体を SVG にする。座標の無い(fallbackPositions にも無い)デバイスと、そこにつながるリンクは描かない
 */
export function renderSvg(
  t: Topology,
  catalog: ModelCatalog,
  options: RenderOptions = {},
): RenderedSvg {
  const labelOptions = {
    showIfName: options.showIfLabels ?? true,
    longIfNames: options.longIfNames ?? false,
    showIp: options.showIp ?? true,
    showVlan: options.showVlan ?? true,
  };
  const padding = options.padding ?? 24;
  const bounds = new Bounds();

  // ゲストを隠すときは、ゲストとそこにつながるリンクを描かない(SPEC 7.3)
  const showGuests = options.showGuests ?? true;
  const positions = new Map<string, Position>();
  for (const [id, device] of t.devices) {
    if (!showGuests && resolveGuest(device, catalog) !== undefined) continue;
    const pos = t.layout.get(id) ?? options.fallbackPositions?.get(id);
    if (pos) positions.set(id, pos);
  }
  // ブリッジ(箱の ID がキー)。ゲストを隠すときは描かない(SPEC 7.3)
  if (showGuests) {
    for (const { key, host } of allBridges(t)) {
      const pos = t.layout.get(key) ?? options.fallbackPositions?.get(key);
      if (pos && positions.has(host)) positions.set(key, pos);
    }
  }
  const centerOf = (id: string) => {
    const pos = positions.get(id) as Position;
    return parseBridgeKey(id) ? bridgeCenter(pos) : iconCenter(pos);
  };

  // グループとホストの枠(いちばん下。外側の枠から描く)。ラベルは背景を付けて線より手前に描く(キャンバスと同じ)。
  // ホストの枠は「グループ」の表示に関係なく、ゲストを描くときに描く
  const frames: string[] = [];
  const frameLabels: string[] = [];
  const kindFilter = options.groupKinds ? groupKindFilter(options.groupKinds) : undefined;
  const visible = (options.showGroups ?? true) ? kindFilter : () => false;
  for (const frame of groupFrames(t, (id) => positions.get(id), visible)) {
    const kind = frame.type === "host" ? undefined : (frame.group.kind ?? "none");
    bounds.add(frame.x, frame.y, frame.x + frame.width, frame.y + frame.height);
    frames.push(
      `<rect x="${n(frame.x)}" y="${n(frame.y)}" width="${n(frame.width)}" height="${n(frame.height)}" ` +
        `rx="10" ${kind ? GROUP_STYLES[kind] : HOST_FRAME_STYLE}/>`,
    );
    const title =
      frame.type === "host" ? hostFrameTitle(t, catalog, frame) : groupTitle(frame.group);
    const size = { width: estimateNameWidth(title), height: 16 };
    const color = kind ? GROUP_TEXT_COLORS[kind] : HOST_FRAME_TEXT_COLOR;
    frameLabels.push(
      label(
        { x: frame.x + 8 + size.width / 2, y: frame.y + 4 + size.height / 2 },
        title,
        size,
        { font: FONT, fontSize: 11, color, border: false, bold: true },
        bounds,
      ),
    );
  }

  // リンク(線は下、ラベルはデバイスより上に描く。キャンバスと同じ重なり)。
  // ブリッジへのリンクはブリッジの箱につなぎ、ブリッジ側の端には IF 名を出さない(SPEC 7.3)
  const drawable = t.links.flatMap((link) => {
    if (!link.a || !link.b) return [];
    const na = endpointNodeId(t, link.a);
    const nb = endpointNodeId(t, link.b);
    return positions.has(na) && positions.has(nb) ? [{ link, a: link.a, b: link.b, na, nb }] : [];
  });
  const slots = parallelSlots(
    drawable.map(({ link, na, nb }) => ({ id: link.id, source: na, target: nb })),
  );
  const lines: string[] = [];
  const linkLabels: string[] = [];
  const nameWidthOf = (id: string) => {
    const device = t.devices.get(id);
    return device ? estimateNameWidth(resolveLabel(device)) : undefined;
  };
  for (const { link, a, b, na, nb } of drawable) {
    const slot = slots.get(link.id) ?? { index: 0, count: 1 };
    const ca = centerOf(na);
    const cb = centerOf(nb);
    const endLabel = (ep: typeof a, node: string) =>
      node === ep.device
        ? ifLabel(ep.iface, interfaceInfo(t.devices.get(ep.device), ep.iface), labelOptions)
        : undefined;
    const aLabel = endLabel(a, na);
    const bLabel = endLabel(b, nb);
    const aLines = aLabel ? ifLabelLines(aLabel) : [];
    const bLines = bLabel ? ifLabelLines(bLabel) : [];
    let path: string;
    let ends: { a: Point; b: Point };
    let center: Point;
    if (na === nb) {
      const loop = selfLoop(ca, slot.index, link.label, { a: aLines, b: bLines });
      path = loop.path;
      ends = { a: loop.labelA, b: loop.labelB };
      center = loop.label;
      // 輪の制御点の範囲(曲線はこの内側に収まる)
      const width = 46 + slot.index * 22;
      const height = 12 + slot.index * 18 + 18 + slot.index * 14;
      bounds.add(ca.x, ca.y - height, ca.x + 26 + width, ca.y + height);
    } else {
      const line = offsetLine(ca, cb, slotOffset(slot), na > nb);
      path = `M ${n(line.a.x)},${n(line.a.y)} L ${n(line.b.x)},${n(line.b.y)}`;
      ends = endLabelPositions(line.a, line.b, aLines, bLines, slot, {
        a: nameWidthOf(na),
        b: nameWidthOf(nb),
      });
      center = midpoint(line.a, line.b);
    }
    lines.push(
      `<path d="${path}" fill="none" stroke-width="2" ${MEDIA_STYLES[linkMedia(link, t, catalog)]}/>`,
    );
    if (aLabel) linkLabels.push(ifLabelSvg(ends.a, aLabel, bounds));
    if (bLabel) linkLabels.push(ifLabelSvg(ends.b, bLabel, bounds));
    if (link.label) {
      const style = { font: FONT, fontSize: 11, color: THEME.textMuted, border: false };
      linkLabels.push(label(center, link.label, estimateLabelSize(link.label), style, bounds));
    }
  }

  // ブリッジとホストの間の線(点線)。ホスト側に、ブリッジの members を出す(SPEC 7.3)
  for (const { key, host, bridge } of allBridges(t)) {
    const members = t.devices.get(host)?.interfaces.get(bridge)?.members ?? [];
    if (!positions.has(key) || !positions.has(host) || members.length === 0) continue;
    const from = bridgeCenter(positions.get(key) as Position);
    const to = iconCenter(positions.get(host) as Position);
    lines.push(
      `<path d="M ${n(from.x)},${n(from.y)} L ${n(to.x)},${n(to.y)}" fill="none" stroke-width="2" ${MEDIA_STYLES.virtual}/>`,
    );
    if (labelOptions.showIfName) {
      const text = members.map((m) => (labelOptions.longIfNames ? expandIfName(m) : m)).join(", ");
      const ends = endLabelPositions(from, to, [], [text], undefined, { b: nameWidthOf(host) });
      linkLabels.push(ifLabelSvg(ends.b, { name: text, details: [] }, bounds));
    }
  }

  // デバイス(角丸の箱の中のアイコンと、その下の名前)とブリッジの箱
  const nodes: string[] = [];
  const iconScale = ICON_SIZE / ROLE_ICON_VIEWBOX;
  for (const [id, pos] of positions) {
    const bridge = parseBridgeKey(id);
    if (bridge) {
      const info = t.devices.get(bridge.host)?.interfaces.get(bridge.bridge);
      nodes.push(bridgeSvg(bridge.bridge, info, pos, labelOptions.showIp, bounds));
      continue;
    }
    const device = t.devices.get(id);
    if (!device) continue;
    const role = resolveRole(device, catalog);
    const boxX = pos.x + (NODE_WIDTH - ICON_BOX) / 2;
    const iconX = pos.x + (NODE_WIDTH - ICON_SIZE) / 2;
    const iconY = pos.y + (ICON_BOX - ICON_SIZE) / 2;
    const name = resolveLabel(device);
    const nameCenter = { x: pos.x + NODE_WIDTH / 2, y: pos.y + NAME_TOP + NAME_HEIGHT / 2 };
    bounds.add(boxX, pos.y, boxX + ICON_BOX, pos.y + ICON_BOX);
    const guest = resolveGuest(device, catalog);
    nodes.push(
      `<g>` +
        `<rect x="${n(boxX)}" y="${n(pos.y)}" width="${ICON_BOX}" height="${ICON_BOX}" rx="12" ` +
        `fill="${THEME.panel}" stroke="${THEME.border}"/>` +
        `<g transform="translate(${n(iconX)} ${n(iconY)}) scale(${iconScale.toFixed(4)})" ` +
        `fill="none" stroke="${ROLE_COLORS[role]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
        `${ROLE_ICON_SVG[role]}</g>` +
        (guest ? badge(boxX + ICON_BOX, pos.y, GUEST_BADGE_TEXT[guest], bounds) : "") +
        label(
          nameCenter,
          name,
          { width: estimateNameWidth(name), height: NAME_HEIGHT },
          { font: FONT, fontSize: NAME_FONT, color: THEME.text, border: false },
          bounds,
        ) +
        `</g>`,
    );
  }

  if (bounds.empty) bounds.add(0, 0, 0, 0);
  const x = Math.floor(bounds.left - padding);
  const y = Math.floor(bounds.top - padding);
  const width = Math.ceil(bounds.right + padding) - x;
  const height = Math.ceil(bounds.bottom + padding) - y;
  const title = t.meta.title ? `<title>${escapeXml(t.meta.title)}</title>` : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${x} ${y} ${width} ${height}">` +
    title +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${THEME.background}"/>` +
    `<g>${frames.join("")}</g>` +
    `<g>${lines.join("")}</g>` +
    `<g>${frameLabels.join("")}</g>` +
    `<g>${nodes.join("")}</g>` +
    `<g>${linkLabels.join("")}</g>` +
    `</svg>\n`;
  return { svg, width, height };
}
