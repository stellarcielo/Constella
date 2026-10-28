// トポロジを扱う小さな共通処理(既定値の解決、エンドポイントの文字列化など)。

import type { Device, DeviceModel, Endpoint, ModelCatalog, Role, Topology } from "./types";

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function createEmptyTopology(): Topology {
  return {
    meta: { extra: {} },
    devices: new Map(),
    links: [],
    layout: new Map(),
    groups: [],
    extra: {},
  };
}

/** メモリ上だけで使う識別子(YAML には書き出さない) */
export function createUid(): string {
  return globalThis.crypto.randomUUID();
}

export function createLinkId(): string {
  return createUid();
}

/** `デバイスID:IF名` を最初の `:` で分割する。どちらかが空なら undefined。 */
export function parseEndpoint(text: string): Endpoint | undefined {
  const i = text.indexOf(":");
  if (i < 0) return undefined;
  const device = text.slice(0, i).trim();
  const iface = text.slice(i + 1).trim();
  if (device === "" || iface === "") return undefined;
  return { device, iface };
}

export function endpointToString(ep: Endpoint): string {
  return `${ep.device}:${ep.iface}`;
}

export function findModel(device: Device, catalog: ModelCatalog): DeviceModel | undefined {
  return device.model === undefined ? undefined : catalog.get(device.model);
}

/** role 省略時はモデルの role、モデルも無ければ generic */
export function resolveRole(device: Device, catalog: ModelCatalog): Role {
  return device.role ?? findModel(device, catalog)?.role ?? "generic";
}

/** label 省略時はデバイスID */
export function resolveLabel(device: Device): string {
  return device.label ?? device.id;
}

/**
 * 定義外の IF 名を使えるデバイスか。
 * model 無し、flexible なモデル、未知のモデル(エラーは別途 1 件だけ出す)が該当する。
 */
export function isFlexibleDevice(device: Device, catalog: ModelCatalog): boolean {
  const model = findModel(device, catalog);
  return model === undefined || model.flexible;
}
