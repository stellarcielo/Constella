// トランシーバ(光モジュール。SPEC 5.4)の一覧と、ポート・リンクの両端に合うかの判定。
// 名前は大文字小文字を区別せず、別名も受け付ける。一覧に無い名前(製品の型番など)は確かめない。

import { isBridgeEndpoint } from "./bridges";
import { interfaceInfo } from "./ifLabel";
import { findLogicalIf } from "./logicalIfs";
import { portTypeOf } from "./ports";
import type { Endpoint, Media, ModelCatalog, PortType, Topology } from "./types";

/** トランシーバの形(挿すポートの種別) */
export type TransceiverForm = Extract<PortType, "sfp" | "sfp+" | "sfp28" | "qsfp+" | "qsfp28">;

/**
 * 中身の種類。optical は光ファイバーをつなぐもの、copper は RJ45 の銅線をつなぐもの、
 * dac・aoc は両端にコネクタの付いたケーブル(銅・光)
 */
export type TransceiverKind = "optical" | "copper" | "dac" | "aoc";

export interface Transceiver {
  name: string;
  form: TransceiverForm;
  kind: TransceiverKind;
  /** BiDi(1 本の光ファイバーで送受信する)の向き。同じ形の U と D を組み合わせて使う */
  bidi?: "u" | "d";
}

/** 一覧(SPEC 5.4 の順)。別名は ALIASES */
export const TRANSCEIVERS: readonly Transceiver[] = [
  { name: "1000BASE-SX", form: "sfp", kind: "optical" },
  { name: "1000BASE-LX", form: "sfp", kind: "optical" },
  { name: "1000BASE-EX", form: "sfp", kind: "optical" },
  { name: "1000BASE-ZX", form: "sfp", kind: "optical" },
  { name: "1000BASE-BX-U", form: "sfp", kind: "optical", bidi: "u" },
  { name: "1000BASE-BX-D", form: "sfp", kind: "optical", bidi: "d" },
  { name: "1000BASE-T", form: "sfp", kind: "copper" },
  { name: "10GBASE-SR", form: "sfp+", kind: "optical" },
  { name: "10GBASE-LRM", form: "sfp+", kind: "optical" },
  { name: "10GBASE-LR", form: "sfp+", kind: "optical" },
  { name: "10GBASE-ER", form: "sfp+", kind: "optical" },
  { name: "10GBASE-ZR", form: "sfp+", kind: "optical" },
  { name: "10GBASE-BX-U", form: "sfp+", kind: "optical", bidi: "u" },
  { name: "10GBASE-BX-D", form: "sfp+", kind: "optical", bidi: "d" },
  { name: "10GBASE-T", form: "sfp+", kind: "copper" },
  { name: "10G-DAC", form: "sfp+", kind: "dac" },
  { name: "10G-AOC", form: "sfp+", kind: "aoc" },
  { name: "25GBASE-SR", form: "sfp28", kind: "optical" },
  { name: "25GBASE-LR", form: "sfp28", kind: "optical" },
  { name: "25G-DAC", form: "sfp28", kind: "dac" },
  { name: "25G-AOC", form: "sfp28", kind: "aoc" },
  { name: "40GBASE-SR4", form: "qsfp+", kind: "optical" },
  { name: "40GBASE-LR4", form: "qsfp+", kind: "optical" },
  { name: "40G-DAC", form: "qsfp+", kind: "dac" },
  { name: "40G-AOC", form: "qsfp+", kind: "aoc" },
  { name: "100GBASE-SR4", form: "qsfp28", kind: "optical" },
  { name: "100GBASE-LR4", form: "qsfp28", kind: "optical" },
  { name: "100GBASE-CWDM4", form: "qsfp28", kind: "optical" },
  { name: "100GBASE-DR", form: "qsfp28", kind: "optical" },
  { name: "100G-DAC", form: "qsfp28", kind: "dac" },
  { name: "100G-AOC", form: "qsfp28", kind: "aoc" },
];

/** 別名 → 一覧の名前 */
const ALIASES: Record<string, string> = {
  "1000BASE-LX10": "1000BASE-LX",
  "1000BASE-LH": "1000BASE-LX",
  "1000BASE-BX10-U": "1000BASE-BX-U",
  "1000BASE-BX10-D": "1000BASE-BX-D",
  "10GBASE-BX10-U": "10GBASE-BX-U",
  "10GBASE-BX10-D": "10GBASE-BX-D",
  "10GBASE-CR": "10G-DAC",
  "25GBASE-CR": "25G-DAC",
  "40GBASE-CR4": "40G-DAC",
  "100GBASE-CR4": "100G-DAC",
};

const BY_NAME = new Map(TRANSCEIVERS.map((t) => [t.name, t]));
for (const [alias, name] of Object.entries(ALIASES)) {
  const transceiver = BY_NAME.get(name);
  if (transceiver) BY_NAME.set(alias, transceiver);
}

/** 一覧にある名前(別名も。大文字小文字は区別しない)なら、そのトランシーバ */
export function findTransceiver(name: string | undefined): Transceiver | undefined {
  return name === undefined ? undefined : BY_NAME.get(name.trim().toUpperCase());
}

/** ポートの種別ごとの、挿せるトランシーバの形(SFP+ のポートに SFP を挿すような、下の速度は許す) */
const ACCEPTS: Partial<Record<PortType, readonly TransceiverForm[]>> = {
  sfp: ["sfp"],
  "sfp+": ["sfp", "sfp+"],
  sfp28: ["sfp", "sfp+", "sfp28"],
  "qsfp+": ["qsfp+"],
  qsfp28: ["qsfp+", "qsfp28"],
};

/** トランシーバを挿せるポートか(RJ45・コンソール・シリアル・無線・仮想には挿せない) */
export function takesTransceiver(type: PortType): boolean {
  return ACCEPTS[type] !== undefined;
}

export function transceiverFits(transceiver: Transceiver, type: PortType): boolean {
  return ACCEPTS[type]?.includes(transceiver.form) ?? false;
}

/** BiDi の相手(U なら同じ形の D)。BiDi でなければ undefined */
export function bidiPartner(transceiver: Transceiver): Transceiver | undefined {
  if (!transceiver.bidi) return undefined;
  const want = transceiver.bidi === "u" ? "d" : "u";
  return TRANSCEIVERS.find((t) => t.form === transceiver.form && t.bidi === want);
}

/** リンクの両端に挿して使えるか。同じもの(別名を含む)、BiDi なら同じ形の U と D */
export function transceiversMatch(a: Transceiver, b: Transceiver): boolean {
  if (a.bidi || b.bidi) return bidiPartner(a) === b;
  return a === b;
}

const MEDIA_OF_KIND: Record<TransceiverKind, Media> = {
  optical: "fiber",
  aoc: "fiber",
  copper: "copper",
  dac: "dac",
};

/** トランシーバから推定する media(SPEC 5.4) */
export function transceiverMedia(transceiver: Transceiver): Media {
  return MEDIA_OF_KIND[transceiver.kind];
}

/**
 * ポート種別を比べるときの種別(SPEC 4.5)。
 * 銅線のトランシーバ(1000BASE-T・10GBASE-T)を挿したポートは、RJ45 のポートとみなす
 */
export function effectivePortType(type: PortType, transceiver: string | undefined): PortType {
  return takesTransceiver(type) && findTransceiver(transceiver)?.kind === "copper" ? "rj45" : type;
}

/** エンドポイントの IF に書かれたトランシーバ(書いたとおりの名前) */
export function endpointTransceiver(t: Topology, ep: Endpoint): string | undefined {
  return interfaceInfo(t.devices.get(ep.device), ep.iface)?.transceiver;
}

/**
 * エンドポイントの IF にトランシーバを挿せるか(リンクの両端にまとめて入れるときに使う)。
 * ブリッジと論理的な IF、RJ45 などのポートには挿せない。種別が分からなければ(フレキシブルデバイスなど)挿せるとみなす
 */
export function endpointTakesTransceiver(
  t: Topology,
  ep: Endpoint,
  catalog: ModelCatalog,
): boolean {
  const device = t.devices.get(ep.device);
  if (!device || isBridgeEndpoint(t, ep) || findLogicalIf(device, ep.iface)) return false;
  const type = portTypeOf(t, ep, catalog);
  return type === undefined || takesTransceiver(type);
}

/**
 * 入力欄の候補(一覧の順)。分かっているポートの種別すべてに挿せるもの。
 * そろって挿せるものが無ければ、どれかに挿せるもの。種別が分からなければ、すべて
 */
export function transceiverOptions(types: readonly (PortType | undefined)[]): Transceiver[] {
  const known = types.filter(
    (type): type is PortType => type !== undefined && takesTransceiver(type),
  );
  if (known.length === 0) return [...TRANSCEIVERS];
  const all = TRANSCEIVERS.filter((t) => known.every((type) => transceiverFits(t, type)));
  return all.length > 0
    ? all
    : TRANSCEIVERS.filter((t) => known.some((type) => transceiverFits(t, type)));
}
