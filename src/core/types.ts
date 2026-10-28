// トポロジとモデル(機種)の型定義。仕様は docs/SPEC.md の 4章・5章を参照。

export const FORMAT_VERSION = 1;

export const ROLES = [
  "router",
  "l2switch",
  "l3switch",
  "firewall",
  "server",
  "pc",
  "ap",
  "cloud",
  "generic",
] as const;
export type Role = (typeof ROLES)[number];

export const MEDIA = ["copper", "fiber", "dac", "wireless", "virtual"] as const;
export type Media = (typeof MEDIA)[number];

export const INTERFACE_MODES = ["access", "trunk", "routed"] as const;
export type InterfaceMode = (typeof INTERFACE_MODES)[number];

export const GROUP_KINDS = ["site", "rack", "vlan", "subnet", "as", "custom"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export const PORT_TYPES = [
  "rj45",
  "sfp",
  "sfp+",
  "sfp28",
  "qsfp+",
  "qsfp28",
  "console",
  "serial",
  "wireless",
  "virtual",
] as const;
export type PortType = (typeof PORT_TYPES)[number];

/**
 * 解釈できなかったキー(未知のキーや不正な値)をそのまま保持する入れ物。
 * 保存時に書き戻してデータが消えないようにする。
 */
export type Extra = Record<string, unknown>;

// ---------------------------------------------------------------------------
// トポロジ
// ---------------------------------------------------------------------------

export interface Topology {
  meta: Meta;
  /** キー = デバイスID。数字だけの ID でも順序が変わらないよう Map を使う */
  devices: Map<string, Device>;
  links: Link[];
  /** キー = デバイスID */
  layout: Map<string, Position>;
  viewport?: Viewport;
  groups: Group[];
  extra: Extra;
}

export interface Meta {
  title?: string;
  description?: string;
  extra: Extra;
}

export interface Device {
  id: string;
  /** 省略時はフレキシブルデバイス */
  model?: string;
  role?: Role;
  label?: string;
  /** キー = 短縮形に正規化した IF 名 */
  interfaces: Map<string, InterfaceInfo>;
  extra: Extra;
}

export interface InterfaceInfo {
  description?: string;
  ip?: string[];
  mode?: InterfaceMode;
  vlan?: number;
  vlans?: string;
  extra: Extra;
}

export interface Endpoint {
  device: string;
  /** 短縮形に正規化した IF 名 */
  iface: string;
}

export interface Link {
  /** メモリ上だけの ID。YAML には書き出さない */
  id: string;
  /** YAML の値が不正なときは undefined(元の値は extra に残る) */
  a?: Endpoint;
  b?: Endpoint;
  media?: Media;
  label?: string;
  extra: Extra;
}

export interface Position {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Group {
  id: string;
  kind?: GroupKind;
  label?: string;
  members: string[];
  extra: Extra;
}

// ---------------------------------------------------------------------------
// モデル(機種)
// ---------------------------------------------------------------------------

export interface PortDef {
  /** 連番展開済みの IF 名 */
  name: string;
  type: PortType;
  speed?: string;
}

export interface DeviceModel {
  id: string;
  vendor?: string;
  name?: string;
  role: Role;
  /** 連番展開済みのポート一覧 */
  ports: PortDef[];
  /** true なら定義外の IF 名も使える */
  flexible: boolean;
  icon?: string;
}

/** キー = モデルID */
export type ModelCatalog = ReadonlyMap<string, DeviceModel>;

/** モデル定義ファイルの問題 */
export interface ModelIssue {
  severity: Severity;
  message: string;
  range?: SourceRange;
}

// ---------------------------------------------------------------------------
// 問題(エラー・警告)
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning";

export type IssueCode =
  // パースエラー(図は直前の正常状態のまま)
  | "yaml-syntax"
  | "invalid-root"
  | "missing-version"
  | "unsupported-version"
  // 意味のエラー・警告(図には反映する)
  | "invalid-type"
  | "invalid-value"
  | "missing-field"
  | "duplicate-key"
  | "unknown-key"
  | "invalid-device-id"
  | "duplicate-device-id"
  | "duplicate-interface"
  | "invalid-endpoint"
  | "unknown-model"
  | "unknown-device"
  | "unknown-interface"
  | "port-in-use"
  | "self-loop"
  | "port-type-mismatch"
  | "unknown-layout-device";

export type IssueTarget =
  | { kind: "document" }
  | { kind: "device"; id: string }
  | { kind: "interface"; device: string; name: string }
  | { kind: "link"; id: string; end?: "a" | "b" }
  | { kind: "layout"; id: string }
  | { kind: "group"; index: number };

/** YAML 文字列内の位置(文字オフセット) */
export interface SourceRange {
  start: number;
  end: number;
}

export interface Issue {
  severity: Severity;
  code: IssueCode;
  message: string;
  target: IssueTarget;
  range?: SourceRange;
}
