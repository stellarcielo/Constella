// パレットとインスペクタのモデル一覧のまとまり。role ごとに分け、ゲスト(VM・コンテナ)のモデルは
// ハイパーバイザのすぐ後に「ゲスト(VM・コンテナ)」としてまとめる(フェーズ4-1 Q4)。

import type { DeviceModel } from "../core";
import { ROLE_LABELS, ROLE_ORDER } from "../icons/roles";

export interface ModelSection {
  key: string;
  label: string;
  models: DeviceModel[];
}

const byName = (a: DeviceModel, b: DeviceModel) => (a.name ?? a.id).localeCompare(b.name ?? b.id);

/** 空のまとまりは除く。まとまりの中は名前の順(ゲストは VM を先に) */
export function modelSections(models: Iterable<DeviceModel>): ModelSection[] {
  const all = [...models];
  return ROLE_ORDER.flatMap((role) => {
    const sections: ModelSection[] = [
      {
        key: role,
        label: ROLE_LABELS[role],
        models: all.filter((m) => m.guest === undefined && m.role === role).sort(byName),
      },
    ];
    if (role === "hypervisor") {
      sections.push({
        key: "guest",
        label: "ゲスト(VM・コンテナ)",
        models: all
          .filter((m) => m.guest !== undefined)
          .sort((a, b) => (a.guest === b.guest ? byName(a, b) : a.guest === "vm" ? -1 : 1)),
      });
    }
    return sections;
  }).filter((s) => s.models.length > 0);
}
