// 表示レイヤー(すべて / L1 / L2 / L3。SPEC 7.3・フェーズ3-3)の表示オプションの組み合わせ。
// キャンバスのツールバー(store/viewLayers.ts)と、CLI の render --layer(SPEC 11 章)で使う。
// 機器・リンクの配置や形は変えない(フェーズ3-3 Q1)。

import type { GroupKind } from "./types";

export const VIEW_LAYERS = ["all", "l1", "l2", "l3"] as const;
export type ViewLayer = (typeof VIEW_LAYERS)[number];

/** レイヤーで決まる表示オプション(長い名前・YAML エディタの表示は含めない) */
export interface LayerOptions {
  showIfLabels: boolean;
  showTransceiver: boolean;
  showIp: boolean;
  showVlan: boolean;
  showGroups: boolean;
  groupKinds: GroupKind[];
  showGuests: boolean;
}

/** レイヤーで出し分ける枠の種類(種類なし・custom・cluster はどのレイヤーでも出す) */
export const LAYER_GROUP_KINDS: readonly GroupKind[] = ["site", "rack", "vlan", "subnet", "as"];

export const LAYER_PRESETS: Record<ViewLayer, LayerOptions> = {
  all: {
    showIfLabels: true,
    showTransceiver: true,
    showIp: true,
    showVlan: true,
    showGroups: true,
    groupKinds: [...LAYER_GROUP_KINDS],
    showGuests: true,
  },
  // 物理: IF 名とトランシーバ、拠点・ラックの枠。ゲスト(VM・コンテナ)は隠す(フェーズ4-1)
  l1: {
    showIfLabels: true,
    showTransceiver: true,
    showIp: false,
    showVlan: false,
    showGroups: true,
    groupKinds: ["site", "rack"],
    showGuests: false,
  },
  // データリンク: IF 名と VLAN、VLAN の枠
  l2: {
    showIfLabels: true,
    showTransceiver: false,
    showIp: false,
    showVlan: true,
    showGroups: true,
    groupKinds: ["vlan"],
    showGuests: true,
  },
  // ネットワーク: IF 名と IP、サブネット・AS の枠
  l3: {
    showIfLabels: true,
    showTransceiver: false,
    showIp: true,
    showVlan: false,
    showGroups: true,
    groupKinds: ["subnet", "as"],
    showGuests: true,
  },
};
