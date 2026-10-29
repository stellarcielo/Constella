// role の表示名と並び順、ゲストの種類の表示名。

import type { GuestKind, Role } from "../core";

export const ROLE_LABELS: Record<Role, string> = {
  cloud: "クラウド",
  router: "ルーター",
  firewall: "ファイアウォール",
  l3switch: "L3 スイッチ",
  l2switch: "L2 スイッチ",
  server: "サーバー",
  hypervisor: "ハイパーバイザ",
  pc: "PC",
  ap: "アクセスポイント",
  generic: "その他",
};

/** ゲストの種類の表示名(SPEC 4.6) */
export const GUEST_LABELS: Record<GuestKind, string> = {
  vm: "VM",
  container: "コンテナ",
};

/** 上流から下流の順(SPEC 9章の自動レイアウトの層と同じ) */
export const ROLE_ORDER: Role[] = [
  "cloud",
  "router",
  "firewall",
  "l3switch",
  "l2switch",
  "hypervisor",
  "server",
  "pc",
  "ap",
  "generic",
];
