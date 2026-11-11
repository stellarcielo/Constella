// リンクの media(ケーブルの種類)。書かれていなければ両端のトランシーバ、無ければポート種別から推定する
// (SPEC 4.3)。推定した値は YAML には書き込まない。

import { isBridgeEndpoint } from "./bridges";
import { portTypeOf } from "./ports";
import { endpointTransceiver, findTransceiver, transceiverMedia } from "./transceivers";
import type { Link, Media, ModelCatalog, PortType, Topology } from "./types";

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

/**
 * media を推定する。
 * どちらかが無線なら wireless、仮想(ブリッジへのリンクを含む。SPEC 4.3)なら virtual。
 * それ以外は、一覧にあるトランシーバ(SPEC 5.4)を書いた端があればそれで決め(両端で違えば端 a)、
 * 無ければ分かる側のポート種別で決め、どちらも分からなければ copper。
 * dac は見た目で光ファイバーと区別できないので、ポート種別からは選ばない(DAC のトランシーバからだけ)。
 */
export function inferMedia(link: Link, t: Topology, catalog: ModelCatalog): Media {
  if ([link.a, link.b].some((ep) => ep && isBridgeEndpoint(t, ep))) return "virtual";
  const types = [link.a, link.b]
    .map((ep) => (ep ? portTypeOf(t, ep, catalog) : undefined))
    .filter((type): type is PortType => type !== undefined);
  if (types.includes("wireless")) return "wireless";
  if (types.includes("virtual")) return "virtual";
  for (const ep of [link.a, link.b]) {
    const transceiver = ep && findTransceiver(endpointTransceiver(t, ep));
    if (transceiver) return transceiverMedia(transceiver);
  }
  return types.length > 0 ? MEDIA_OF_PORT[types[0]] : "copper";
}

/** 書かれた media、無ければ推定した media */
export function linkMedia(link: Link, t: Topology, catalog: ModelCatalog): Media {
  return link.media ?? inferMedia(link, t, catalog);
}
