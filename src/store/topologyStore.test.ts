import { describe, expect, it, vi } from "vitest";
import { specExample, testCatalog } from "../core/testFixtures";
import { createTopologyStore, EMPTY_YAML } from "./topologyStore";

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
    expect(store.getState().yamlText).toBe(EMPTY_YAML);
    expect(store.getState().dirty).toBe(false);
  });

  it("新規のファイルは先頭に JSON Schema のコメントがあり、編集しても残る", () => {
    const store = setup();
    expect(EMPTY_YAML).toBe(
      "# yaml-language-server: $schema=https://raw.githubusercontent.com/stellarcielo/Constella/main/schema/constella.schema.json\nconstella: 1\n",
    );
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    expect(store.getState().yamlText.startsWith(`${EMPTY_YAML}\ndevices:\n  rt1:`)).toBe(true);
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

describe("topologyStore: 取り消し・やり直し(SPEC 7.4)", () => {
  it("GUI の編集 1 回が 1 ステップ。YAML も一緒に戻る", () => {
    const store = setup();
    const s = () => store.getState();
    expect(s().canUndo).toBe(false);
    s().addDevice("generic-router-4", { x: 0, y: 0 });
    const afterFirst = s().yamlText;
    s().addDevice("generic-router-4", { x: 0, y: 0 });
    expect(s().canUndo).toBe(true);
    s().undo();
    expect([...s().topology.devices.keys()]).toEqual(["rt1"]);
    expect(s().yamlText).toBe(afterFirst);
    expect(s().yamlOrigin).toBe("history");
    expect(s().canRedo).toBe(true);
    s().undo();
    expect(s().topology.devices.size).toBe(0);
    expect(s().canUndo).toBe(false);
    s().redo();
    s().redo();
    expect([...s().topology.devices.keys()]).toEqual(["rt1", "rt2"]);
    expect(s().canRedo).toBe(false);
  });

  it("YAML の読み込み 1 回が 1 ステップ。GUI の編集と混ざっても逆順に戻る", () => {
    const store = setup();
    const s = () => store.getState();
    s().openText(specExample);
    s().moveDevices([["rt1", { x: 1, y: 1 }]]);
    s().setYamlDraft(s().yamlText.replace("label: Edge Router", "label: R1"));
    s().commitYamlDraft();
    s().moveDevices([["rt1", { x: 2, y: 2 }]]);
    s().undo();
    expect(s().topology.layout.get("rt1")).toEqual({ x: 1, y: 1 });
    expect(s().topology.devices.get("rt1")?.label).toBe("R1");
    s().undo();
    expect(s().topology.devices.get("rt1")?.label).toBe("Edge Router");
    s().undo();
    expect(s().yamlText).toBe(specExample);
    expect(s().dirty).toBe(false);
  });

  it("取り消すと識別子も戻るので、選択が外れない", () => {
    const store = setup();
    const s = () => store.getState();
    s().openText(specExample);
    const linkId = s().topology.links[1].id;
    s().setSelection({ devices: ["rt1"], links: [linkId] });
    s().deleteDevices(["srv1"]);
    s().undo();
    expect(s().topology.links.map((l) => l.id)).toContain(linkId);
    expect(s().selection).toEqual({ devices: ["rt1"], links: [linkId] });
  });

  it("打ち込み中の内容は、1 ステップにしてから取り消す", () => {
    const store = setup();
    const s = () => store.getState();
    s().openText(specExample);
    s().setYamlDraft(specExample.replace("label: mgmt", "label: x"));
    s().undo();
    expect(s().yamlText).toBe(specExample);
    s().redo();
    expect(s().yamlText).toContain("label: x");
  });

  it("新しく編集すると、やり直しの履歴は消える", () => {
    const store = setup();
    const s = () => store.getState();
    s().addDevice("generic-router-4", { x: 0, y: 0 });
    s().undo();
    s().addDevice("generic-server-2", { x: 0, y: 0 });
    expect(s().canRedo).toBe(false);
    s().redo();
    expect([...s().topology.devices.keys()]).toEqual(["srv1"]);
  });

  it("同じ機器を 1 秒以内に続けて動かしたら 1 ステップにまとめる", () => {
    vi.useFakeTimers();
    try {
      const store = setup();
      const s = () => store.getState();
      s().addDevice("generic-router-4", { x: 0, y: 0 });
      const move = (x: number) =>
        s().moveDevices([["rt1", { x, y: 0 }]], { coalesce: "arrow:rt1" });
      move(5);
      vi.advanceTimersByTime(300);
      move(10);
      vi.advanceTimersByTime(300);
      move(15);
      vi.advanceTimersByTime(1500);
      move(20);
      s().undo();
      expect(s().topology.layout.get("rt1")).toEqual({ x: 15, y: 0 });
      s().undo();
      expect(s().topology.layout.get("rt1")).toEqual({ x: 0, y: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ファイルを開くと履歴は空になる", () => {
    const store = setup();
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    store.getState().openText(specExample);
    expect(store.getState().canUndo).toBe(false);
    store.getState().undo();
    expect(store.getState().yamlText).toBe(specExample);
  });

  it("構文エラーのとき、最初の取り消しは最後に正しく読めた状態に戻すだけ", () => {
    const store = setup();
    const s = () => store.getState();
    s().openText(specExample);
    s().moveDevices([["rt1", { x: 1, y: 1 }]]);
    const valid = s().yamlText;
    s().setYamlDraft("constella: 1\ndevices: [\n");
    s().commitYamlDraft();
    expect(s().canUndo).toBe(true);
    s().undo();
    expect(s().yamlErrors).toEqual([]);
    expect(s().yamlText).toBe(valid);
    s().undo();
    expect(s().yamlText).toBe(specExample);
  });

  it("構文エラーのファイルを開いた直後は、取り消す先が無い", () => {
    const store = setup();
    store.getState().openText("constella: 1\ndevices: [\n");
    expect(store.getState().canUndo).toBe(false);
    store.getState().undo();
    expect(store.getState().yamlText).toBe("constella: 1\ndevices: [\n");
  });

  it("取り消せるのは最新の 200 ステップまで", () => {
    const store = setup();
    const s = () => store.getState();
    for (let i = 1; i <= 205; i++) s().moveDevices([["x", { x: i, y: 0 }]]);
    s().addDevice("generic-router-4", { x: 0, y: 0 });
    for (let i = 1; i <= 202; i++) s().moveDevices([["rt1", { x: i, y: 0 }]]);
    let count = 0;
    while (s().canUndo) {
      s().undo();
      count++;
    }
    expect(count).toBe(200);
  });
});

describe("自動レイアウト", () => {
  const noLayout = `constella: 1
# 手書きのメモ
devices:
  srv1: { model: generic-server-2 }
  rt1: { model: generic-router-4 }
  isp: { role: cloud }
links:
  - { a: srv1:eth0, b: rt1:Gi0/1 }
  - { a: rt1:Gi0/0, b: isp:wan }
`;
  const placed = async (store: ReturnType<typeof setup>) =>
    vi.waitFor(() => expect(store.getState().placing).toBe(false));
  const autoY = (store: ReturnType<typeof setup>, id: string) => {
    const s = store.getState();
    const uid = s.topology.devices.get(id)?.uid ?? "";
    return s.autoPositions.get(uid)?.y ?? NaN;
  };

  it("座標の無いファイルを開くと並べるが、YAML は変えない", async () => {
    const store = setup();
    store.getState().openText(noLayout);
    expect(store.getState().placing).toBe(true);
    await placed(store);
    expect(autoY(store, "isp")).toBeLessThan(autoY(store, "rt1"));
    expect(autoY(store, "rt1")).toBeLessThan(autoY(store, "srv1"));
    expect(store.getState().yamlText).toBe(noLayout);
    expect(store.getState().dirty).toBe(false);
  });

  it("座標のあるデバイスは動かさず、無いデバイスだけを下に置く", async () => {
    const store = setup();
    store.getState().openText(specExample);
    await placed(store);
    const s = store.getState();
    expect(s.topology.layout.get("rt1")).toEqual({ x: 300, y: 80 });
    expect(s.autoPositions.size).toBe(2);
    expect(autoY(store, "srv1")).toBeGreaterThan(240);
  });

  it("いちど決まった位置は、ほかの編集や ID の変更で変わらない", async () => {
    const store = setup();
    store.getState().openText(noLayout);
    await placed(store);
    const before = autoY(store, "srv1");
    store.getState().renameDevice("srv1", "web1");
    store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
    await placed(store);
    expect(autoY(store, "web1")).toBe(before);
  });

  it("YAML エディタで書き足したデバイスも並べる", async () => {
    const store = setup();
    store.getState().openText(noLayout);
    await placed(store);
    store
      .getState()
      .setYamlDraft(noLayout.replace("devices:\n", "devices:\n  pc1: { role: pc }\n"));
    store.getState().commitYamlDraft();
    await placed(store);
    expect(Number.isNaN(autoY(store, "pc1"))).toBe(false);
  });

  it("自動整列は全デバイスを layout に書き、1 回で取り消せる。コメントは残る", async () => {
    const store = setup();
    store.getState().openText(noLayout);
    await placed(store);
    await store.getState().autoArrange();
    const s = store.getState();
    expect([...s.topology.layout.keys()].sort()).toEqual(["isp", "rt1", "srv1"]);
    expect(s.yamlText).toContain("# 手書きのメモ");
    expect(s.yamlText).toContain("layout:");
    expect(s.dirty).toBe(true);
    store.getState().undo();
    expect(store.getState().yamlText).toBe(noLayout);
    expect(store.getState().topology.layout.size).toBe(0);
  });
});
