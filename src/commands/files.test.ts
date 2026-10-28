import { describe, expect, it, vi } from "vitest";
import {
  changeModel,
  lineColumn,
  locateTarget,
  parseTopology,
  setDeviceLabel,
  setDeviceRole,
  type Topology,
  updateInterface,
  updateLink,
  updateMeta,
  type Viewport,
} from "../core";
import { specExample, testCatalog } from "../core/testFixtures";
import { createTopologyStore } from "../store/topologyStore";
import { createFileCommands, defaultFileName, documentName, type UnsavedChoice } from "./files";

interface FakeState {
  open: { path: string; text: string } | null;
  savePath: string | null;
  writeError?: Error;
  unsaved: UnsavedChoice;
}

function setup(initial: Partial<FakeState> = {}) {
  const state: FakeState = { open: null, savePath: null, unsaved: "cancel", ...initial };
  const store = createTopologyStore(testCatalog);
  const written: { path: string; text: string }[] = [];
  const errors: { title: string; message: string; details?: string[] }[] = [];
  const asked: string[] = [];
  const views: (Viewport | undefined)[] = [];
  const platform = {
    openTextFile: vi.fn(async () => state.open),
    chooseSavePath: vi.fn<(name: string) => Promise<string | null>>(async () => state.savePath),
    writeTextFile: vi.fn(async (path: string, text: string) => {
      if (state.writeError) throw state.writeError;
      written.push({ path, text });
    }),
    closeWindow: vi.fn(async () => {}),
  };
  const commands = createFileCommands({
    platform,
    store,
    resetView: (viewport) => views.push(viewport),
    askUnsaved: async (name) => {
      asked.push(name);
      return state.unsaved;
    },
    showError: async (title, message, details) => {
      errors.push({ title, message, details });
    },
  });
  return { state, store, platform, commands, written, errors, asked, views };
}

/** 未保存の変更を作る */
function makeDirty(env: ReturnType<typeof setup>) {
  env.store.getState().addDevice("generic-router-4", { x: 0, y: 0 });
}

describe("開く", () => {
  it("読み込んだ図を表示し、未保存の印は付かない", async () => {
    const env = setup({ open: { path: "/lab/home.constella.yaml", text: specExample } });
    await env.commands.open();
    const s = env.store.getState();
    expect([...s.topology.devices.keys()]).toEqual(["rt1", "core-sw1", "srv1", "isp"]);
    expect(s.filePath).toBe("/lab/home.constella.yaml");
    expect(s.dirty).toBe(false);
    expect(s.base).toBeDefined();
    expect(env.views).toEqual([undefined]);
  });

  it("_viewport があればその表示位置にする(Q6)", async () => {
    const env = setup({
      open: {
        path: "a.yaml",
        text: "constella: 1\nlayout:\n  _viewport: { x: 10, y: 20, zoom: 2 }\n",
      },
    });
    await env.commands.open();
    expect(env.views).toEqual([{ x: 10, y: 20, zoom: 2 }]);
  });

  it("ファイル由来の問題も一覧に出す", async () => {
    const env = setup({
      open: { path: "a.yaml", text: "constella: 1\nowner: me\ndevices:\n  rt1: { model: nope }\n" },
    });
    await env.commands.open();
    expect(env.store.getState().issues.map((i) => i.code)).toEqual([
      "unknown-key",
      "unknown-model",
    ]);
  });

  it("構文エラーなら行番号付きで知らせ、今の図は残す(Q3)", async () => {
    const env = setup({
      open: { path: "/x/broken.yaml", text: "constella: 1\ndevices:\n  rt1: [\n" },
    });
    makeDirty(env);
    env.state.unsaved = "discard";
    const before = env.store.getState().topology;
    await env.commands.open();
    expect(env.errors).toHaveLength(1);
    expect(env.errors[0].title).toBe("broken.yaml を開けませんでした");
    expect(env.errors[0].details?.[0]).toMatch(/^\d+ 行目 \d+ 文字目: YAML の構文エラー/);
    expect(env.store.getState().topology).toBe(before);
    expect(env.store.getState().filePath).toBeUndefined();
  });

  it("キャンセルなら何もしない", async () => {
    const env = setup({ open: null });
    await env.commands.open();
    expect(env.store.getState().filePath).toBeUndefined();
    expect(env.views).toEqual([]);
  });

  it("未保存の変更があれば先に確認し、キャンセルなら開かない", async () => {
    const env = setup({ open: { path: "a.yaml", text: specExample }, unsaved: "cancel" });
    makeDirty(env);
    await env.commands.open();
    expect(env.asked).toEqual(["無題"]);
    expect(env.platform.openTextFile).not.toHaveBeenCalled();
  });

  it("「保存しない」なら変更を捨てて開く", async () => {
    const env = setup({ open: { path: "a.yaml", text: specExample }, unsaved: "discard" });
    makeDirty(env);
    await env.commands.open();
    expect(env.store.getState().filePath).toBe("a.yaml");
    expect(env.written).toEqual([]);
  });

  it("「保存」で保存先の選択をキャンセルしたら開かない", async () => {
    const env = setup({
      open: { path: "a.yaml", text: specExample },
      unsaved: "save",
      savePath: null,
    });
    makeDirty(env);
    await env.commands.open();
    expect(env.platform.chooseSavePath).toHaveBeenCalled();
    expect(env.platform.openTextFile).not.toHaveBeenCalled();
  });

  it("読み込みに失敗したら知らせる", async () => {
    const env = setup();
    env.platform.openTextFile.mockRejectedValueOnce(new Error("permission denied"));
    await env.commands.open();
    expect(env.errors[0]).toMatchObject({ title: "開けませんでした" });
  });
});

describe("保存", () => {
  it("新規なら保存先を選び、タイトルから初期のファイル名を作る(Q4)", async () => {
    const env = setup({ savePath: "/lab/x.constella.yaml" });
    env.store.getState().edit((t) => updateMeta(t, { title: "自宅ラボ: DC/区画" }));
    expect(await env.commands.save()).toBe(true);
    expect(env.platform.chooseSavePath).toHaveBeenCalledWith("自宅ラボ_ DC_区画.constella.yaml");
    expect(env.written[0].path).toBe("/lab/x.constella.yaml");
    expect(env.store.getState().filePath).toBe("/lab/x.constella.yaml");
    expect(env.store.getState().dirty).toBe(false);
  });

  it("保存済みのファイルには確認なしで上書きし、変更が無ければ書かない", async () => {
    const env = setup({ open: { path: "/lab/a.constella.yaml", text: specExample } });
    await env.commands.open();
    expect(await env.commands.save()).toBe(true);
    expect(env.written).toEqual([]);
    env.store.getState().moveDevices([["rt1", { x: 320, y: 100 }]]);
    expect(await env.commands.save()).toBe(true);
    expect(env.platform.chooseSavePath).not.toHaveBeenCalled();
    expect(env.written[0].path).toBe("/lab/a.constella.yaml");
    // 開いたファイルのコメントは残る
    expect(env.written[0].text).toContain("# 座標が無いデバイスは自動レイアウトで配置する");
    expect(env.written[0].text).toContain("rt1: { x: 320, y: 100 }");
  });

  it("別名で保存は今のファイル名を初期値にし、キャンセルなら何も変えない", async () => {
    const env = setup({
      open: { path: "/lab/a.constella.yaml", text: specExample },
      savePath: null,
    });
    await env.commands.open();
    expect(await env.commands.saveAs()).toBe(false);
    expect(env.platform.chooseSavePath).toHaveBeenCalledWith("a.constella.yaml");
    expect(env.store.getState().filePath).toBe("/lab/a.constella.yaml");
  });

  it("書き込みに失敗したら知らせ、未保存のまま", async () => {
    const env = setup({ savePath: "/ro/x.yaml", writeError: new Error("read-only") });
    makeDirty(env);
    expect(await env.commands.save()).toBe(false);
    expect(env.errors[0]).toMatchObject({ title: "保存できませんでした" });
    expect(env.store.getState().dirty).toBe(true);
    expect(env.store.getState().filePath).toBeUndefined();
  });

  it("保存すると、問題の位置が保存したファイルの位置になり、直した問題は消える(1-9 Q1)", async () => {
    const env = setup({
      open: {
        path: "/lab/a.constella.yaml",
        text: "constella: 1\ndevices:\n  rt1:\n    role: toaster\n",
      },
    });
    await env.commands.open();
    expect(env.store.getState().issues.map((i) => i.code)).toEqual(["invalid-value"]);
    env.store.getState().edit((t) => setDeviceRole(t, "rt1", "router", testCatalog));
    env.store.getState().addDevice("generic-server-2", { x: 0, y: 0 });
    await env.commands.save();
    const s = env.store.getState();
    expect(s.issues).toEqual([]);
    expect(s.fileText).toBe(env.written[0].text);
    const range = s.base && locateTarget(s.base, { kind: "device", id: "srv1" });
    expect(range && lineColumn(env.written[0].text, range.start).line).toBe(5);
  });

  it("続けて保存すると、前回の保存結果に差分を当てる", async () => {
    const env = setup({ savePath: "/lab/x.constella.yaml" });
    makeDirty(env);
    await env.commands.save();
    env.store.getState().addDevice("generic-server-2", { x: 0, y: 100 });
    await env.commands.save();
    expect(env.written).toHaveLength(2);
    expect(env.written[1].text).toContain("srv1:");
    expect(env.written[1].text.indexOf("rt1:")).toBeLessThan(env.written[1].text.indexOf("srv1:"));
  });
});

describe("新規・閉じる", () => {
  it("新規は未保存なら確認し、「保存しない」なら空の図にする", async () => {
    const env = setup({ open: { path: "a.yaml", text: specExample }, unsaved: "discard" });
    await env.commands.open();
    makeDirty(env);
    await env.commands.newFile();
    const s = env.store.getState();
    expect(s.topology.devices.size).toBe(0);
    expect(s.filePath).toBeUndefined();
    expect(s.dirty).toBe(false);
    expect(env.asked).toEqual(["a.yaml"]);
  });

  it("終了は未保存なら確認し、キャンセルなら閉じない", async () => {
    const env = setup({ unsaved: "cancel" });
    makeDirty(env);
    await env.commands.quit();
    expect(env.platform.closeWindow).not.toHaveBeenCalled();
    env.state.unsaved = "discard";
    await env.commands.quit();
    expect(env.platform.closeWindow).toHaveBeenCalled();
  });

  it("変更が無ければ確認せずに閉じてよい", async () => {
    const env = setup();
    expect(await env.commands.confirmClose()).toBe(true);
    expect(env.asked).toEqual([]);
  });
});

describe("ファイル名", () => {
  it("documentName と defaultFileName", () => {
    expect(documentName()).toBe("無題");
    expect(documentName("/a/b/lab.constella.yaml")).toBe("lab.constella.yaml");
    expect(defaultFileName()).toBe("無題.constella.yaml");
    expect(defaultFileName("  ")).toBe("無題.constella.yaml");
    expect(defaultFileName("a|b")).toBe("a_b.constella.yaml");
    expect(defaultFileName("x", "/p/q.yaml")).toBe("q.yaml");
  });
});

/** メモリ上だけの識別子と座標を除いて比べられる形にする */
function semantic(t: Topology): unknown {
  return JSON.parse(
    JSON.stringify({
      meta: t.meta,
      devices: [...t.devices.values()].map((d) => ({
        ...d,
        uid: undefined,
        interfaces: [...d.interfaces],
      })),
      links: t.links.map((l) => ({ ...l, id: undefined })),
      groups: t.groups,
      extra: t.extra,
    }),
  );
}

describe("フェーズ1の完了条件", () => {
  it("SPEC 4.2 の例と同等の図を GUI の操作だけで作って保存し、開き直すと同じ図になる", async () => {
    const env = setup({ savePath: "/lab/home.constella.yaml" });
    const s = () => env.store.getState();
    // パレットから配置
    s().addDevice("generic-router-4", { x: 300, y: 80 });
    s().addDevice("cisco-c2960-24tt-l", { x: 300, y: 240 });
    s().addDevice("generic-server-2", { x: 300, y: 400 });
    s().addDevice("generic-cloud", { x: 300, y: -80 });
    // インスペクタで編集
    expect(s().renameDevice("sw1", "core-sw1")).toBeUndefined();
    s().edit((t) => changeModel(t, "cloud1", undefined, testCatalog, { removeLostPorts: true }));
    expect(s().renameDevice("cloud1", "isp")).toBeUndefined();
    s().edit((t) => setDeviceLabel(t, "rt1", "Edge Router"));
    s().edit((t) =>
      updateInterface(t, "core-sw1", "Gi0/1", { description: "to rt1" }, testCatalog),
    );
    // ポート選択で接続
    s().addLink({ device: "rt1", iface: "Gi0/0" }, { device: "isp", iface: "wan" });
    s().addLink({ device: "rt1", iface: "Gi0/1" }, { device: "core-sw1", iface: "Gi0/1" });
    const mgmt = s().addLink(
      { device: "core-sw1", iface: "Fa0/1" },
      { device: "srv1", iface: "eth0" },
    );
    s().edit((t) => updateLink(t, mgmt, { label: "mgmt" }));
    s().edit((t) =>
      updateMeta(t, { title: "自宅ラボ DC 区画", description: "学習用ルーティング網" }),
    );
    const layout = new Map(s().topology.layout);

    // 保存して開き直す
    expect(await env.commands.save()).toBe(true);
    env.state.open = { path: "/lab/home.constella.yaml", text: env.written[0].text };
    await env.commands.open();

    const expected = parseTopology(specExample, { catalog: testCatalog });
    if (!expected.ok) throw new Error();
    expect(semantic(s().topology)).toEqual(semantic(expected.topology));
    expect(s().topology.layout).toEqual(layout);
    expect(s().issues).toEqual([]);
    expect(s().dirty).toBe(false);
  });
});
