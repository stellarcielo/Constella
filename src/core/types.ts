// トポロジとモデル(機種)の型定義。仕様は docs/SPEC.md の 4章・5章を参照。

export const FORMAT_VERSION = 1;

/** トポロジ YAML の JSON Schema(schema/constella.schema.json)の公開 URL(SPEC 11章) */
export const SCHEMA_URL =
  "https://raw.githubusercontent.com/stellarcielo/Constella/main/schema/constella.schema.json";

/** ファイルの先頭に書くと、対応エディタで補完と検証が効くコメント行 */
export const SCHEMA_COMMENT = `# yaml-language-server: $schema=${SCHEMA_URL}`;

export const ROLES = [
  "router",
  "l2switch",
  "l3switch",
  "firewall",
  "server",
  "hypervisor",
  "pc",
  "ap",
  "cloud",
  "generic",
] as const;
export type Role = (typeof ROLES)[number];

/** ゲストの種類(SPEC 4.6): VM(仮想マシン)とコンテナ(Proxmox VE の LXC) */
export const GUEST_KINDS = ["vm", "container"] as const;
export type GuestKind = (typeof GUEST_KINDS)[number];

/** VMID(Proxmox VE が VM・コンテナに振る番号)の範囲 */
export const VMID_MIN = 100;
export const VMID_MAX = 999999999;

export const MEDIA = ["copper", "fiber", "dac", "wireless", "virtual"] as const;
export type Media = (typeof MEDIA)[number];

export const INTERFACE_MODES = ["access", "trunk", "routed"] as const;
export type InterfaceMode = (typeof INTERFACE_MODES)[number];

/** 論理的な IF の種類(SPEC 4.6): bond・ブリッジ・VLAN インターフェース */
export const LOGICAL_IF_TYPES = ["bond", "bridge", "vlan"] as const;
export type LogicalIfType = (typeof LOGICAL_IF_TYPES)[number];

/** bond のモード(Linux の bonding のモード。SPEC 4.3) */
export const BOND_MODES = [
  "balance-rr",
  "active-backup",
  "balance-xor",
  "broadcast",
  "802.3ad",
  "balance-tlb",
  "balance-alb",
] as const;
export type BondMode = (typeof BOND_MODES)[number];

/** SDN のゾーンの種類(SPEC 4.6) */
export const SDN_ZONE_TYPES = ["simple", "vlan", "qinq", "vxlan", "evpn"] as const;
export type SdnZoneType = (typeof SDN_ZONE_TYPES)[number];

/** VNet の tag の最大(vxlan・evpn の VNI は 24 ビット。vlan・qinq では 4094 まで) */
export const VNI_MAX = 16777215;

export const GROUP_KINDS = ["site", "rack", "vlan", "subnet", "as", "cluster", "custom"] as const;
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
  /**
   * 手で動かした IF 名ラベルの位置(layout._labels。SPEC 4.3)。
   * キー = ラベルの付く端(デバイスID:IF名。IF 名は短い形)
   */
  labelLayout: Map<string, LabelOffset>;
  viewport?: Viewport;
  groups: Group[];
  /** SDN のゾーンと VNet(SPEC 4.6) */
  sdn: Sdn;
  extra: Extra;
}

export interface Meta {
  title?: string;
  description?: string;
  extra: Extra;
}

export interface Device {
  id: string;
  /** メモリ上だけの識別子。YAML には書き出さず、ID を変えても変わらない */
  uid: string;
  /** 省略時はフレキシブルデバイス */
  model?: string;
  role?: Role;
  label?: string;
  /** ゲストのとき、動いているホストのデバイスID(SPEC 4.6) */
  host?: string;
  /** 省略時はモデルの guest。どちらも無く host があれば vm */
  guest?: GuestKind;
  vmid?: number;
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
  /** 論理的な IF の種類。省略時は物理的な IF(SPEC 4.6) */
  type?: LogicalIfType;
  /** bond で束ねる IF、ブリッジにつなぐ IF(同じデバイスの IF 名) */
  members?: string[];
  /** YAML では bond-mode */
  bondMode?: BondMode;
  /** YAML では vlan-aware */
  vlanAware?: boolean;
  /** VLAN インターフェースの親の IF。YAML では vlan-raw-device */
  vlanRawDevice?: string;
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

/** 手で動かしたラベルの位置。線の端から線に沿った距離と、線からの横のずれ(外を向いて右がプラス) */
export interface LabelOffset {
  along: number;
  side: number;
}

export interface Group {
  id: string;
  kind?: GroupKind;
  label?: string;
  members: string[];
  /** クラスタのネットワーク(kind: cluster。SPEC 4.6)。名前 → サブネット(書いたとおり)。書いた順 */
  networks?: Map<string, string>;
  extra: Extra;
}

/** SDN(SPEC 4.6)。VNet は、ゾーンの各ホストの中のブリッジとして扱う */
export interface Sdn {
  /** キー = ゾーンID */
  zones: Map<string, SdnZone>;
  /** キー = VNet ID */
  vnets: Map<string, SdnVnet>;
  extra: Extra;
}

export interface SdnZone {
  /** 必須。YAML の値が無い・不正なときは undefined */
  type?: SdnZoneType;
  /** vlan・qinq で使う、各ホストのブリッジ */
  bridge?: string;
  /** qinq の外側の VLAN ID */
  tag?: number;
  /** ゾーンを使うホストのデバイスID。省略時は、ロールが hypervisor の機器すべて */
  nodes?: string[];
  extra: Extra;
}

export interface SdnVnet {
  /** 必須。YAML の値が無い・不正なときは undefined */
  zone?: string;
  /** VLAN ID(qinq では内側の VLAN、vxlan・evpn では VNI) */
  tag?: number;
  subnets?: string[];
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
  /** このモデルの機器はゲスト(SPEC 4.6) */
  guest?: GuestKind;
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
  | "duplicate-group-id"
  | "duplicate-interface"
  | "invalid-endpoint"
  | "unknown-model"
  | "unknown-device"
  | "unknown-interface"
  | "port-in-use"
  | "self-loop"
  | "port-type-mismatch"
  | "unknown-layout-device"
  | "unknown-label"
  | "host-cycle"
  | "duplicate-vmid"
  | "member-in-use"
  | "invalid-bridge-link"
  | "invalid-member"
  | "invalid-logical-link"
  | "invalid-vlan-interface"
  | "invalid-vlan-list"
  | "vlan-not-allowed"
  | "multiple-clusters"
  | "invalid-subnet"
  | "networks-not-cluster"
  | "missing-cluster-network"
  | "unknown-sdn-zone"
  | "missing-zone-bridge"
  | "vnet-outside-zone"
  | "invalid-vnet-tag"
  | "vnet-name-conflict"
  | "long-vnet-id";

export type IssueTarget =
  | { kind: "document" }
  /** field があれば、YAML ではその項目の値を指す */
  | { kind: "device"; id: string; field?: string }
  | { kind: "interface"; device: string; name: string }
  | { kind: "link"; id: string; end?: "a" | "b" }
  | { kind: "layout"; id: string }
  /** 手で動かしたラベルの位置(layout._labels のキー) */
  | { kind: "label"; key: string }
  /** field があれば、YAML ではその項目の値を指す。network があれば、networks のその名前を指す */
  | { kind: "group"; index: number; field?: string; network?: string }
  /** SDN のゾーン・VNet。field があれば、YAML ではその項目の値を指す */
  | { kind: "sdn"; section: "zones" | "vnets"; id: string; field?: string };

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
