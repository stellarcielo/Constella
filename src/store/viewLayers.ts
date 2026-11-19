// 表示レイヤー(すべて / L1 / L2 / L3。SPEC 7.3・フェーズ3-3)。
// レイヤーは表示オプションのプリセット(まとめて設定する組み合わせ)で、選んだあとも個々に調整できる。
// プリセットの中身は core(CLI でも使う)にあり、ここではボタンの文字と、今のレイヤーの判定を受け持つ。

import { LAYER_PRESETS, VIEW_LAYERS, type ViewLayer } from "../core";
import type { ViewOptions } from "./uiStore";

export {
  LAYER_GROUP_KINDS,
  LAYER_PRESETS,
  type LayerOptions,
  VIEW_LAYERS,
  type ViewLayer,
} from "../core";

export const LAYER_LABELS: Record<ViewLayer, { short: string; title: string }> = {
  all: {
    short: "すべて",
    title: "すべてのレイヤー: IF 名・トランシーバ・IP・VLAN・ゲストと、すべての枠",
  },
  l1: { short: "L1", title: "L1(物理): IF 名とトランシーバ、拠点・ラックの枠。ゲストは隠す" },
  l2: { short: "L2", title: "L2(データリンク): IF 名と VLAN、VLAN の枠" },
  l3: { short: "L3", title: "L3(ネットワーク): IF 名と IP、サブネット・AS の枠" },
};

/** 今の表示オプションが当たるレイヤー。個々に調整してどのプリセットとも違えば undefined */
export function currentLayer(view: ViewOptions): ViewLayer | undefined {
  return VIEW_LAYERS.find((layer) => {
    const preset = LAYER_PRESETS[layer];
    return (
      view.showIfLabels === preset.showIfLabels &&
      view.showTransceiver === preset.showTransceiver &&
      view.showIp === preset.showIp &&
      view.showVlan === preset.showVlan &&
      view.showGroups === preset.showGroups &&
      view.showGuests === preset.showGuests &&
      view.groupKinds.length === preset.groupKinds.length &&
      preset.groupKinds.every((kind) => view.groupKinds.includes(kind))
    );
  });
}
