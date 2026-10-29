// トポロジを SVG の文字列にする(SVG / PNG の書き出し。将来の CLI の `constella render` でも使う)。
// 見た目はキャンバスに合わせ、ライトテーマ・白背景で描く(フェーズ2-4 Q2)。選択や問題の印は描かない。

import { groupFrames, groupKindFilter, groupTitle, hostFrameTitle } from "./groupFrames";
import { resolveGuest } from "./hosts";
import { ROLE_ICON_SVG, ROLE_ICON_VIEWBOX } from "./icons";
import { type IfLabel, ifLabel, ifLabelLines, interfaceInfo } from "./ifLabel";
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
import type { GroupKind, GuestKind, Media, ModelCatalog, Position, Role, Topology } from "./types";

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

/** ゲストの印。アイコンの箱の右上の角(right, top)に重ねる */
function guestBadge(right: number, top: number, text: string, bounds: Bounds): string {
  const width = 20;
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

  // リンク(線は下、ラベルはデバイスより上に描く。キャンバスと同じ重なり)
  const drawable = t.links.flatMap((link) =>
    link.a && link.b && positions.has(link.a.device) && positions.has(link.b.device)
      ? [{ link, a: link.a, b: link.b }]
      : [],
  );
  const slots = parallelSlots(
    drawable.map(({ link, a, b }) => ({ id: link.id, source: a.device, target: b.device })),
  );
  const lines: string[] = [];
  const linkLabels: string[] = [];
  const nameWidthOf = (id: string) => {
    const device = t.devices.get(id);
    return device ? estimateNameWidth(resolveLabel(device)) : undefined;
  };
  for (const { link, a, b } of drawable) {
    const slot = slots.get(link.id) ?? { index: 0, count: 1 };
    const ca = iconCenter(positions.get(a.device) as Position);
    const cb = iconCenter(positions.get(b.device) as Position);
    const aLabel = ifLabel(a.iface, interfaceInfo(t.devices.get(a.device), a.iface), labelOptions);
    const bLabel = ifLabel(b.iface, interfaceInfo(t.devices.get(b.device), b.iface), labelOptions);
    const aLines = aLabel ? ifLabelLines(aLabel) : [];
    const bLines = bLabel ? ifLabelLines(bLabel) : [];
    let path: string;
    let ends: { a: Point; b: Point };
    let center: Point;
    if (a.device === b.device) {
      const loop = selfLoop(ca, slot.index, link.label, { a: aLines, b: bLines });
      path = loop.path;
      ends = { a: loop.labelA, b: loop.labelB };
      center = loop.label;
      // 輪の制御点の範囲(曲線はこの内側に収まる)
      const width = 46 + slot.index * 22;
      const height = 12 + slot.index * 18 + 18 + slot.index * 14;
      bounds.add(ca.x, ca.y - height, ca.x + 26 + width, ca.y + height);
    } else {
      const line = offsetLine(ca, cb, slotOffset(slot), a.device > b.device);
      path = `M ${n(line.a.x)},${n(line.a.y)} L ${n(line.b.x)},${n(line.b.y)}`;
      ends = endLabelPositions(line.a, line.b, aLines, bLines, slot, {
        a: nameWidthOf(a.device),
        b: nameWidthOf(b.device),
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

  // デバイス(角丸の箱の中のアイコンと、その下の名前)
  const nodes: string[] = [];
  const iconScale = ICON_SIZE / ROLE_ICON_VIEWBOX;
  for (const [id, pos] of positions) {
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
        (guest ? guestBadge(boxX + ICON_BOX, pos.y, GUEST_BADGE_TEXT[guest], bounds) : "") +
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
