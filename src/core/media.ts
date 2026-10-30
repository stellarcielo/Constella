// リンクの media(ケーブルの種類)。書かれていなければ両端のポート種別から推定する(SPEC 4.3)。
// 推定した値は YAML には書き込まない。

import { isBridgeEndpoint } from "./bridges";
import { ifNameKey } from "./ifname";
import { findModel } from "./topology";
import type { Endpoint, Link, Media, ModelCatalog, PortType, Topology } from "./types";

const MEDIA_OF_PORT: Record<PortType, Media> = {
  rj45: "copper",
  console: "copper",
  serial: "copper",
  sfp: "fiber",
  "sfp+": "fiber",
  sfp28: "fiber",
  "qsfp+": "fiber",
  qsfp28: "fiber",
  wireless: "wireless",
  virtual: "virtual",
};

/** エンドポイントのポート種別。フレキシブルデバイスでモデルに無い IF などは undefined */
export function portTypeOf(t: Topology, ep: Endpoint, catalog: ModelCatalog): PortType | undefined {
  const device = t.devices.get(ep.device);
  if (!device) return undefined;
  const key = ifNameKey(ep.iface);
  return findModel(device, catalog)?.ports.find((p) => ifNameKey(p.name) === key)?.type;
}

/**
 * ポート種別から media を推定する。
 * どちらかが無線なら wireless、仮想(ブリッジへのリンクを含む。SPEC 4.3)なら virtual。
 * それ以外は分かる側の種別で決め、両方分からなければ copper。
 * dac は見た目で光ファイバーと区別できないので推定では選ばない(YAML に書いたときだけ使う)。
 */
export function inferMedia(link: Link, t: Topology, catalog: ModelCatalog): Media {
  if ([link.a, link.b].some((ep) => ep && isBridgeEndpoint(t, ep))) return "virtual";
  const types = [link.a, link.b]
    .map((ep) => (ep ? portTypeOf(t, ep, catalog) : undefined))
    .filter((type): type is PortType => type !== undefined);
  if (types.includes("wireless")) return "wireless";
  if (types.includes("virtual")) return "virtual";
  return types.length > 0 ? MEDIA_OF_PORT[types[0]] : "copper";
}

/** 書かれた media、無ければ推定した media */
export function linkMedia(link: Link, t: Topology, catalog: ModelCatalog): Media {
  return link.media ?? inferMedia(link, t, catalog);
}
