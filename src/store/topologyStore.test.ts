import { describe, expect, it, vi } from "vitest";
import { specExample, testCatalog } from "../core/testFixtures";
import { createTopologyStore } from "./topologyStore";

function setup() {
  return createTopologyStore(testCatalog);
}

describe("topologyStore", () => {
  it("最初は空で、未保存の変更もない", () => {
    const s = setup().getState();
    expect(s.topology.devices.size).toBe(0);
    expect(s.dirty).toBe(false);
    expect(s.issues).toEqual([]);
  });

  it("デバイスを追加すると未保存になる", () => {
    const store = setup();
    const id = store.getState().addDevice("generic-router-4", { x: 100, y: 50 });
    const s = store.getState();
    expect(id).toBe("rt1");
    expect(s.topology.devices.get("rt1")?.model).toBe("generic-router-4");
    expect(s.topology.layout.get("rt1")).toEqual({ x: 100, y: 50 });
    expect(s.dirty).toBe(true);
  });

  it("編集のたびに検証し直す", () => {
    const store = setup();
    store.getState().addDevice("no-such-model", { x: 0, y: 0 });
    expect(store.getState().issues.map((i) => i.code)).toEqual(["unknown-model"]);
    store.getState().deleteDevices(["dev1"]);
    expect(store.getState().issues).toEqual([]);
  });

  it("編集前のトポロジは変わらない(Immer)", () => {
    const store = setup();
    const before = store.getState().topology;
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    expect(before.devices.size).toBe(0);
    expect(store.getState().topology).not.toBe(before);
  });

  it("位置が変わらない移動は編集にしない", () => {
    const store = setup();
    store.getState().addDevice("generic-router-4", { x: 10, y: 20 });
    const before = store.getState().topology;
    store.getState().moveDevices([["rt1", { x: 10.2, y: 19.8 }]]);
    expect(store.getState().topology).toBe(before);
    store.getState().moveDevices([["rt1", { x: 30, y: 40 }]]);
    expect(store.getState().topology.layout.get("rt1")).toEqual({ x: 30, y: 40 });
  });

  it("選択中のデバイスを削除すると選択からも外れる", () => {
    const store = setup();
    const { addDevice } = store.getState();
    addDevice("generic-router-4", { x: 0, y: 0 });
    addDevice("generic-router-4", { x: 0, y: 0 });
    addDevice("generic-server-2", { x: 0, y: 0 });
    store.getState().setSelection({ devices: ["rt1", "srv1"], links: [] });
    store.getState().deleteSelection();
    const s = store.getState();
    expect([...s.topology.devices.keys()]).toEqual(["rt2"]);
    expect(s.selection).toEqual({ devices: [], links: [] });
  });

  it("何も選択していなければ削除しても何も起きない", () => {
    const store = setup();
    const before = store.getState();
    store.getState().deleteSelection();
    expect(store.getState().topology).toBe(before.topology);
    expect(store.getState().dirty).toBe(false);
  });

  it("同じ選択を設定しても状態を更新しない", () => {
    const store = setup();
    store.getState().setSelection({ devices: ["a", "b"], links: [] });
    const sel = store.getState().selection;
    store.getState().setSelection({ devices: ["b", "a"], links: [] });
    expect(store.getState().selection).toBe(sel);
  });

  it("リンクを追加すると検証し直す", () => {
    const store = setup();
    const { addDevice } = store.getState();
    addDevice("generic-router-4", { x: 0, y: 0 });
    addDevice("generic-l2switch-24", { x: 0, y: 0 });
    store.getState().addLink({ device: "rt1", iface: "Gi0/0" }, { device: "sw1", iface: "Te0/25" });
    const s = store.getState();
    expect(s.topology.links).toHaveLength(1);
    expect(s.issues.map((i) => i.code)).toEqual(["port-type-mismatch"]);
  });

  it("リンクを選択して削除する", () => {
    const store = setup();
    const { addDevice } = store.getState();
    addDevice("generic-router-4", { x: 0, y: 0 });
    addDevice("generic-router-4", { x: 0, y: 0 });
    const id = store
      .getState()
      .addLink({ device: "rt1", iface: "Gi0/0" }, { device: "rt2", iface: "Gi0/0" });
    store.getState().setSelection({ devices: [], links: [id] });
    store.getState().deleteSelection();
    expect(store.getState().topology.links).toEqual([]);
    expect(store.getState().topology.devices.size).toBe(2);
    expect(store.getState().selection.links).toEqual([]);
  });

  it("デバイスID を変えると、リンクの参照と選択も付け替える(Immer の中でも順序を保つ)", () => {
    const store = setup();
    const { addDevice } = store.getState();
    addDevice("generic-router-4", { x: 0, y: 0 });
    addDevice("generic-server-2", { x: 0, y: 0 });
    addDevice("generic-l2switch-24", { x: 0, y: 0 });
    store.getState().addLink({ device: "rt1", iface: "Gi0/0" }, { device: "srv1", iface: "eth0" });
    store.getState().setSelection({ devices: ["srv1"], links: [] });
    expect(store.getState().renameDevice("srv1", "web1")).toBeUndefined();
    const s = store.getState();
    expect([...s.topology.devices.keys()]).toEqual(["rt1", "web1", "sw1"]);
    expect(s.topology.devices.get("web1")?.id).toBe("web1");
    expect(s.topology.layout.has("web1")).toBe(true);
    expect(s.topology.links[0].b).toEqual({ device: "web1", iface: "eth0" });
    expect(s.selection.devices).toEqual(["web1"]);
  });

  it("使えない ID なら理由を返して何も変えない", () => {
    const store = setup();
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    const before = store.getState().topology;
    expect(store.getState().renameDevice("rt1", "rt2")).toBe("「rt2」は既に使われています");
    expect(store.getState().topology).toBe(before);
  });

  it("開いたファイルを読み込むと、未保存の印と選択が消え、YAML 由来の問題も出す", () => {
    const store = setup();
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    store.getState().setSelection({ devices: ["rt1"], links: [] });
    const text =
      "constella: 1\nowner: me\ndevices:\n  rt1:\n    vendor: acme\nlayout:\n  ghost: here\n";
    store.getState().openText(text, "/a.yaml");
    const s = store.getState();
    expect(s.filePath).toBe("/a.yaml");
    expect(s.yamlText).toBe(text);
    expect(s.yamlOrigin).toBe("file");
    expect(s.dirty).toBe(false);
    expect(s.selection).toEqual({ devices: [], links: [] });
    expect(s.issues.map((i) => i.code)).toEqual(["unknown-key", "unknown-key", "invalid-value"]);
  });

  it("GUI で削除したデバイスの、YAML 由来の問題は消える", () => {
    const store = setup();
    store.getState().openText("constella: 1\ndevices:\n  rt1:\n    vendor: acme\n  rt2: {}\n");
    expect(store.getState().issues).toHaveLength(1);
    store.getState().deleteDevices(["rt1"]);
    expect(store.getState().issues).toEqual([]);
  });

  it("保存したら未保存の印を消し、ファイルのパスを覚える", () => {
    const store = setup();
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    store.getState().markSaved("/b.yaml", store.getState().yamlText);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().filePath).toBe("/b.yaml");
  });

  it("保存中に編集されていたら、未保存の印は残す", () => {
    const store = setup();
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    const saving = store.getState().yamlText;
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    store.getState().markSaved("/b.yaml", saving);
    expect(store.getState().dirty).toBe(true);
  });

  it("新規にすると空の図になる", () => {
    const store = setup();
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    store.getState().newDocument();
    expect(store.getState().topology.devices.size).toBe(0);
    expect(store.getState().filePath).toBeUndefined();
    expect(store.getState().yamlText).toBe("constella: 1\n");
    expect(store.getState().dirty).toBe(false);
  });
});

describe("topologyStore: YAML との同期(SPEC 8章)", () => {
  it("GUI で編集すると YAML を作り直し、コメントは残る", () => {
    const store = setup();
    store.getState().openText(specExample, "/lab.yaml");
    store.getState().moveDevices([["srv1", { x: 10, y: 20 }]]);
    const s = store.getState();
    expect(s.yamlOrigin).toBe("gui");
    expect(s.yamlText).toContain("srv1: { x: 10, y: 20 }");
    expect(s.yamlText).toContain("# model 省略 = フレキシブル");
    expect(s.dirty).toBe(true);
  });

  it("問題の位置は、作り直した YAML の位置", () => {
    const store = setup();
    store.getState().addDevice("no-such-model", { x: 0, y: 0 });
    const s = store.getState();
    const range = s.issues[0].range;
    expect(s.issues[0].code).toBe("unknown-model");
    expect(range && s.yamlText.slice(range.start, range.end)).toBe("dev1");
  });

  it("エディタの内容は読み込むまで図に反映せず、読み込むと識別子を引き継いで反映する", () => {
    const store = setup();
    store.getState().openText(specExample);
    const linkIds = store.getState().topology.links.map((l) => l.id);
    store.getState().setSelection({ devices: ["rt1"], links: [linkIds[2]] });
    const edited = specExample.replace("label: Edge Router", "label: Core Router");
    store.getState().setYamlDraft(edited);
    expect(store.getState().topology.devices.get("rt1")?.label).toBe("Edge Router");
    store.getState().commitYamlDraft();
    const s = store.getState();
    expect(s.topology.devices.get("rt1")?.label).toBe("Core Router");
    expect(s.yamlText).toBe(edited);
    expect(s.yamlOrigin).toBe("yaml");
    expect(s.topology.links.map((l) => l.id)).toEqual(linkIds);
    expect(s.selection).toEqual({ devices: ["rt1"], links: [linkIds[2]] });
    expect(s.dirty).toBe(true);
  });

  it("書き換えて元に戻せば、未保存の印は消える", () => {
    const store = setup();
    store.getState().openText(specExample);
    store.getState().setYamlDraft(specExample + "# memo\n");
    store.getState().commitYamlDraft();
    expect(store.getState().dirty).toBe(true);
    store.getState().setYamlDraft(specExample);
    store.getState().commitYamlDraft();
    expect(store.getState().dirty).toBe(false);
  });

  it("構文エラーなら図は最後に正しく読めた状態のまま(SPEC 8.3)", () => {
    const store = setup();
    store.getState().openText(specExample);
    const before = store.getState().topology;
    store.getState().setYamlDraft("constella: 1\ndevices: [\n");
    store.getState().commitYamlDraft();
    const s = store.getState();
    expect(s.topology).toBe(before);
    expect(s.yamlErrors.map((i) => i.code)).toEqual(["yaml-syntax"]);
    expect(s.issues[0].code).toBe("yaml-syntax");
    expect(s.yamlText).toBe("constella: 1\ndevices: [\n");
  });

  it("構文エラーの間の GUI の編集は確認し、上書きを選べば最後に正しかった状態から当てる", async () => {
    let answer = true;
    const confirm = vi.fn(async () => answer);
    const store = createTopologyStore(testCatalog, { confirmOverwrite: confirm });
    store.getState().openText(specExample);
    store.getState().setYamlDraft("constella: 1\ndevices: [\n");
    store.getState().commitYamlDraft();

    answer = false;
    store.getState().moveDevices([["rt1", { x: 1, y: 1 }]]);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(store.getState().yamlErrors).toHaveLength(1);
    expect(store.getState().rejectedEdits).toBe(1);

    answer = true;
    store.getState().moveDevices([["rt1", { x: 1, y: 1 }]]);
    await vi.waitFor(() => expect(store.getState().yamlErrors).toEqual([]));
    const s = store.getState();
    expect(s.topology.layout.get("rt1")).toEqual({ x: 1, y: 1 });
    expect(s.yamlText).toContain("rt1: { x: 1, y: 1 }");
    expect(s.yamlText).toContain("# 座標が無いデバイスは自動レイアウトで配置する");
  });

  it("打ち込み中の内容は、GUI の編集の前に読み込む(消えない)", () => {
    const store = setup();
    store.getState().openText(specExample);
    store.getState().setYamlDraft(specExample.replace("label: mgmt", "label: management"));
    store.getState().moveDevices([["rt1", { x: 5, y: 5 }]]);
    const s = store.getState();
    expect(s.yamlText).toContain("label: management");
    expect(s.yamlText).toContain("rt1: { x: 5, y: 5 }");
    expect(s.yamlDraft).toBeUndefined();
  });

  it("構文エラーのあるファイルも開ける(図は空)", () => {
    const store = setup();
    store.getState().openText("constella: 1\ndevices: [\n", "/broken.yaml");
    const s = store.getState();
    expect(s.topology.devices.size).toBe(0);
    expect(s.yamlErrors).toHaveLength(1);
    expect(s.filePath).toBe("/broken.yaml");
    expect(s.dirty).toBe(false);
  });
});
