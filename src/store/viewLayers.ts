// 表示レイヤー(すべて / L1 / L2 / L3。SPEC 7.3・フェーズ3-3)。
// レイヤーは表示オプションのプリセット(まとめて設定する組み合わせ)で、選んだあとも個々に調整できる。
// 機器・リンクの配置や形は変えない(フェーズ3-3 Q1)。

import type { GroupKind } from "../core";
import type { ViewOptions } from "./uiStore";

export const VIEW_LAYERS = ["all", "l1", "l2", "l3"] as const;
export type ViewLayer = (typeof VIEW_LAYERS)[number];

/** レイヤーで決まる表示オプション(長い名前・YAML エディタの表示は含めない) */
export type LayerOptions = Pick<
  ViewOptions,
  "showIfLabels" | "showIp" | "showVlan" | "showGroups" | "groupKinds"
>;

/** レイヤーで出し分ける枠の種類(種類なし・custom はどのレイヤーでも出す) */
export const LAYER_GROUP_KINDS: readonly GroupKind[] = ["site", "rack", "vlan", "subnet", "as"];

export const LAYER_PRESETS: Record<ViewLayer, LayerOptions> = {
  all: {
    showIfLabels: true,
    showIp: true,
    showVlan: true,
    showGroups: true,
    groupKinds: [...LAYER_GROUP_KINDS],
  },
  // 物理: IF 名と、拠点・ラックの枠
  l1: {
    showIfLabels: true,
    showIp: false,
    showVlan: false,
    showGroups: true,
    groupKinds: ["site", "rack"],
  },
  // データリンク: IF 名と VLAN、VLAN の枠
  l2: { showIfLabels: true, showIp: false, showVlan: true, showGroups: true, groupKinds: ["vlan"] },
  // ネットワーク: IF 名と IP、サブネット・AS の枠
  l3: {
    showIfLabels: true,
    showIp: true,
    showVlan: false,
    showGroups: true,
    groupKinds: ["subnet", "as"],
  },
};

export const LAYER_LABELS: Record<ViewLayer, { short: string; title: string }> = {
  all: { short: "すべて", title: "すべてのレイヤー: IF 名・IP・VLAN と、すべての枠" },
  l1: { short: "L1", title: "L1(物理): IF 名と、拠点・ラックの枠" },
  l2: { short: "L2", title: "L2(データリンク): IF 名と VLAN、VLAN の枠" },
  l3: { short: "L3", title: "L3(ネットワーク): IF 名と IP、サブネット・AS の枠" },
};

/** 今の表示オプションが当たるレイヤー。個々に調整してどのプリセットとも違えば undefined */
export function currentLayer(view: ViewOptions): ViewLayer | undefined {
  return VIEW_LAYERS.find((layer) => {
    const preset = LAYER_PRESETS[layer];
    return (
      view.showIfLabels === preset.showIfLabels &&
      view.showIp === preset.showIp &&
      view.showVlan === preset.showVlan &&
      view.showGroups === preset.showGroups &&
      view.groupKinds.length === preset.groupKinds.length &&
      preset.groupKinds.every((kind) => view.groupKinds.includes(kind))
    );
  });
}
