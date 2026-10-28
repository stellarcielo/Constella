// role の表示名と並び順。

import type { Role } from "../core";

export const ROLE_LABELS: Record<Role, string> = {
  cloud: "クラウド",
  router: "ルーター",
  firewall: "ファイアウォール",
  l3switch: "L3 スイッチ",
  l2switch: "L2 スイッチ",
  server: "サーバー",
  pc: "PC",
  ap: "アクセスポイント",
  generic: "その他",
};

/** 上流から下流の順(SPEC 9章の自動レイアウトの層と同じ) */
export const ROLE_ORDER: Role[] = [
  "cloud",
  "router",
  "firewall",
  "l3switch",
  "l2switch",
  "server",
  "pc",
  "ap",
  "generic",
];
