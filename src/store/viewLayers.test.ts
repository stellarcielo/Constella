import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, type ViewOptions } from "./uiStore";
import { currentLayer, LAYER_PRESETS, VIEW_LAYERS } from "./viewLayers";

const withLayer = (layer: keyof typeof LAYER_PRESETS, extra: Partial<ViewOptions> = {}) => ({
  ...DEFAULT_VIEW,
  ...LAYER_PRESETS[layer],
  ...extra,
});

describe("表示レイヤー(フェーズ3-3)", () => {
  it("L1 は IF 名と拠点・ラック、L2 は VLAN、L3 は IP とサブネット・AS", () => {
    expect(LAYER_PRESETS.l1).toMatchObject({
      showIp: false,
      showVlan: false,
      groupKinds: ["site", "rack"],
    });
    expect(LAYER_PRESETS.l2).toMatchObject({ showIp: false, showVlan: true, groupKinds: ["vlan"] });
    expect(LAYER_PRESETS.l3).toMatchObject({
      showIp: true,
      showVlan: false,
      groupKinds: ["subnet", "as"],
    });
    for (const layer of VIEW_LAYERS) expect(LAYER_PRESETS[layer].showIfLabels).toBe(true);
  });

  it("L1 だけはゲストを隠す(フェーズ4-1)", () => {
    expect(VIEW_LAYERS.map((layer) => LAYER_PRESETS[layer].showGuests)).toEqual([
      true,
      false,
      true,
      true,
    ]);
    expect(currentLayer(withLayer("l1", { showGuests: true }))).toBeUndefined();
  });

  it("既定の表示は「すべて」に当たる", () => {
    expect(currentLayer(DEFAULT_VIEW)).toBe("all");
  });

  it("プリセットどおりならそのレイヤー、個々に変えたらどれにも当たらない", () => {
    for (const layer of VIEW_LAYERS) expect(currentLayer(withLayer(layer))).toBe(layer);
    expect(currentLayer(withLayer("l2", { showIp: true }))).toBeUndefined();
    expect(currentLayer(withLayer("l1", { showGroups: false }))).toBeUndefined();
    expect(currentLayer(withLayer("l3", { groupKinds: ["subnet"] }))).toBeUndefined();
  });

  it("長い名前・YAML エディタの表示や、枠の種類の順番は判定に関係しない", () => {
    expect(currentLayer(withLayer("l3", { longIfNames: true, showYaml: false }))).toBe("l3");
    expect(currentLayer(withLayer("l1", { groupKinds: ["rack", "site"] }))).toBe("l1");
  });
});
