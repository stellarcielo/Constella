// role ごとのオリジナルのシンプルな線画アイコン(SPEC 15章)。キャンバスと SVG の書き出しで共有する。
// 48×48 の座標で描いた SVG の中身。線の色は呼ぶ側が stroke で指定する。
// モデルの icon(SPEC 5.1)で、組み込みのほかのアイコンや、アイコンのフォルダの画像(SVG・PNG)に変えられる。

import { ROLES, type Role } from "./types";

export const ROLE_ICON_VIEWBOX = 48;

export const ROLE_ICON_SVG: Record<Role, string> = {
  // 円の中に 4 方向の矢印(経路を振り分けるイメージ)
  router:
    '<circle cx="24" cy="24" r="17"/>' +
    '<path d="M24 10v10M20 14l4-4 4 4M24 38V28M20 34l4 4 4-4M10 24h10M14 20l-4 4 4 4M38 24H28M34 20l4 4-4 4"/>',
  // 箱の中に左右の矢印
  l2switch:
    '<rect x="6" y="12" width="36" height="24" rx="3"/>' +
    '<path d="M13 20h20M29 16l4 4-4 4M35 28H15M19 24l-4 4 4 4"/>',
  // 箱の中に左右の矢印 + 上向きの矢印(ルーティングもできるスイッチ)
  l3switch:
    '<rect x="6" y="14" width="36" height="24" rx="3"/>' +
    '<path d="M13 22h20M29 18l4 4-4 4M35 30H15M19 26l-4 4 4 4M24 14V5M20 9l4-4 4 4"/>',
  // レンガの壁
  firewall:
    '<rect x="6" y="9" width="36" height="30" rx="2"/>' +
    '<path d="M6 19h36M6 29h36M18 9v10M30 9v10M12 19v10M24 19v10M36 19v10M18 29v10M30 29v10"/>',
  // 物理的なホストの上に、VM(箱)が 3 つ載っている
  hypervisor:
    '<rect x="6" y="31" width="36" height="10" rx="2"/>' +
    '<path d="M11 36h2M18 36h18"/>' +
    '<rect x="7" y="8" width="10" height="15" rx="2"/>' +
    '<rect x="19" y="8" width="10" height="15" rx="2"/>' +
    '<rect x="31" y="8" width="10" height="15" rx="2"/>' +
    '<path d="M12 23v8M24 23v8M36 23v8"/>',
  // ラックの箱が 3 段
  server:
    '<rect x="10" y="6" width="28" height="11" rx="2"/>' +
    '<rect x="10" y="19" width="28" height="11" rx="2"/>' +
    '<rect x="10" y="32" width="28" height="11" rx="2"/>' +
    '<path d="M15 11.5h2M15 24.5h2M15 37.5h2M24 11.5h9M24 24.5h9M24 37.5h9"/>',
  // モニターとスタンド
  pc: '<rect x="6" y="8" width="36" height="24" rx="2"/><path d="M24 32v6M15 40h18"/>',
  // 点と電波
  ap:
    '<circle cx="24" cy="34" r="2.5"/>' +
    '<path d="M17 27a10 10 0 0 1 14 0M11 21a18 18 0 0 1 26 0M5 15a26 26 0 0 1 38 0"/>' +
    '<path d="M14 42h20"/>',
  cloud: '<path d="M14 36h21a8 8 0 0 0 .8-15.96A11 11 0 0 0 14.6 18.3 9 9 0 0 0 14 36z"/>',
  // 汎用: 角丸の箱にポートの点
  generic:
    '<rect x="7" y="13" width="34" height="22" rx="4"/>' +
    '<path d="M14 29h2M20 29h2M26 29h2M32 29h2"/>',
};

/** モデルの icon(SPEC 5.1)。組み込みのアイコン(role と同じ名前)か、アイコンのフォルダの画像 */
export type IconRef = { kind: "builtin"; role: Role } | { kind: "image"; file: string };

/** 取り込める画像の大きさの上限(SPEC 5.2) */
export const ICON_MAX_BYTES = 1024 * 1024;

/** 画像のアイコンのファイル名か(.svg・.png) */
export function isIconImageName(name: string): boolean {
  return /\.(svg|png)$/i.test(name);
}

/** icon の値。組み込みのアイコンの名前でも、画像のファイル名(フォルダを含まない)でもなければ undefined */
export function parseIconRef(icon: string): IconRef | undefined {
  if ((ROLES as readonly string[]).includes(icon)) return { kind: "builtin", role: icon as Role };
  if (isIconImageName(icon) && !/[\\/]/.test(icon)) return { kind: "image", file: icon };
  return undefined;
}

/**
 * 機器に描くアイコン(SPEC 7.3)。モデルの icon が無い・読めないとき、
 * 画像が見つからないとき(hasImage が false)は role のアイコン
 */
export function resolveIcon(
  role: Role,
  icon: string | undefined,
  hasImage: (file: string) => boolean,
): IconRef {
  const ref = icon === undefined ? undefined : parseIconRef(icon);
  if (!ref || (ref.kind === "image" && !hasImage(ref.file))) return { kind: "builtin", role };
  return ref;
}

/** 画像のアイコンの MIME タイプ */
export function iconMimeType(file: string): string {
  return /\.svg$/i.test(file) ? "image/svg+xml" : "image/png";
}

/**
 * 取り込む画像の、アイコンのフォルダでのファイル名。フォルダの区切りを除き、空白を -、
 * ファイル名に使いにくい文字を _ にして、拡張子は小文字にする。同じ名前があれば -2、-3 … を付ける
 */
export function uniqueIconName(name: string, used: (file: string) => boolean): string {
  const base = (name.split(/[\\/]/).pop() ?? name).trim();
  const match = /^(.*)\.(svg|png)$/i.exec(base);
  const stem = (match ? match[1] : base).replace(/\s+/g, "-").replace(/[:*?"<>|#]/g, "_") || "icon";
  const ext = match ? match[2].toLowerCase() : "png";
  for (let n = 1; ; n++) {
    const candidate = `${stem}${n === 1 ? "" : `-${n}`}.${ext}`;
    if (!used(candidate)) return candidate;
  }
}
