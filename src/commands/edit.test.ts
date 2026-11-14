import { describe, expect, it, vi } from "vitest";
import { specExample, testCatalog } from "../core/testFixtures";
import { createTopologyStore } from "../store/topologyStore";
import { createEditCommands } from "./edit";

function setup() {
  const store = createTopologyStore(testCatalog);
  store.getState().openText(specExample);
  const clipboard = { text: "" };
  const focus = { textInput: false };
  const textCommand = vi.fn();
  const commands = createEditCommands({
    store,
    clipboard: {
      readClipboardText: async () => clipboard.text,
      writeClipboardText: async (text: string) => {
        clipboard.text = text;
      },
    },
    isTextInputFocused: () => focus.textInput,
    textCommand,
  });
  return { clipboard, focus, textCommand, commands, s: () => store.getState() };
}

describe("コピー・貼り付け", () => {
  it("何も選んでいなければコピーしない", async () => {
    const env = setup();
    expect(await env.commands.copy()).toBe(false);
    expect(env.clipboard.text).toBe("");
  });

  it("選択したデバイスとその間のリンクを YAML としてコピーする", async () => {
    const env = setup();
    env.s().setSelection({ devices: ["rt1", "core-sw1"], links: [] });
    expect(await env.commands.copy()).toBe(true);
    expect(env.clipboard.text).toContain("constella: 1");
    expect(env.clipboard.text).toContain("  rt1:\n    model: generic-router-4");
    expect(env.clipboard.text).toContain("a: rt1:Gi0/1\n    b: core-sw1:Gi0/1");
    expect(env.clipboard.text).not.toContain("srv1");
  });

  it("貼り付けると ID を振り直して選択し、続けて貼るたびに右下へずらす", async () => {
    const env = setup();
    env.s().setSelection({ devices: ["rt1"], links: [] });
    await env.commands.copy();
    expect(await env.commands.paste()).toBe(true);
    expect(env.s().selection.devices).toEqual(["rt2"]);
    expect(env.s().topology.layout.get("rt2")).toEqual({ x: 340, y: 120 });
    await env.commands.paste();
    expect(env.s().topology.layout.get("rt3")).toEqual({ x: 380, y: 160 });
    // コピーし直すと、ずらす量は最初に戻る
    env.s().setSelection({ devices: ["rt1"], links: [] });
    await env.commands.copy();
    await env.commands.paste();
    expect(env.s().topology.layout.get("rt4")).toEqual({ x: 340, y: 120 });
  });

  it("位置を渡すと、断片の真ん中をその位置に合わせる(SPEC 7.6)", async () => {
    const env = setup();
    env.s().setSelection({ devices: ["rt1", "core-sw1"], links: [] });
    await env.commands.copy();
    expect(await env.commands.paste({ x: 1000, y: 500 })).toBe(true);
    const [a, b] = env.s().selection.devices.map((id) => env.s().topology.layout.get(id));
    if (!a || !b) throw new Error();
    expect({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }).toEqual({ x: 1000, y: 500 });
    // 位置を渡した貼り付けは、続けて貼るときのずらす量に数えない
    await env.commands.paste();
    expect(env.s().topology.layout.get("rt3")).toEqual({ x: 340, y: 120 });
  });

  it("貼り付けは 1 回で取り消せる", async () => {
    const env = setup();
    env.s().setSelection({ devices: ["rt1", "core-sw1"], links: [] });
    await env.commands.copy();
    await env.commands.paste();
    expect(env.s().topology.devices.size).toBe(6);
    env.commands.undo();
    expect(env.s().topology.devices.size).toBe(4);
  });

  it("切り取りはコピーしてから削除する", async () => {
    const env = setup();
    env.s().setSelection({ devices: ["srv1"], links: [] });
    expect(await env.commands.cut()).toBe(true);
    expect(env.s().topology.devices.has("srv1")).toBe(false);
    expect(env.clipboard.text).toContain("srv1:");
  });

  it("外で書いた YAML の断片も貼り付けられる", async () => {
    const env = setup();
    env.clipboard.text = "devices:\n  edge: { model: generic-router-4 }\n  lab: { role: cloud }\n";
    expect(await env.commands.paste()).toBe(true);
    expect(env.s().selection.devices).toEqual(["rt2", "cloud1"]);
  });

  it("貼れるものが無ければ何もしない", async () => {
    const env = setup();
    env.clipboard.text = "https://example.com";
    const before = env.s().topology;
    expect(await env.commands.paste()).toBe(false);
    expect(env.s().topology).toBe(before);
  });
});

describe("すべて選択・取り消し", () => {
  it("すべてのデバイスとリンクを選択する", () => {
    const env = setup();
    env.commands.selectAll();
    expect(env.s().selection.devices).toEqual(["rt1", "core-sw1", "srv1", "isp"]);
    expect(env.s().selection.links).toHaveLength(3);
  });

  it("ブリッジの箱も選択する(フェーズ4-2)", () => {
    const env = setup();
    env.s().edit((t) => {
      t.devices.get("srv1")?.interfaces.set("br0", { type: "bridge", extra: {} });
    });
    env.commands.selectAll();
    expect(env.s().selection.devices).toEqual(["rt1", "core-sw1", "srv1", "isp", "srv1:br0"]);
  });

  it("入力欄にフォーカスがあれば、入力欄の取り消しに回す", () => {
    const env = setup();
    env.s().addDevice("generic-router-4", { x: 0, y: 0 });
    env.focus.textInput = true;
    env.commands.undo();
    expect(env.textCommand).toHaveBeenCalledWith("undo");
    expect(env.s().topology.devices.has("rt2")).toBe(true);
    env.focus.textInput = false;
    env.commands.undo();
    expect(env.s().topology.devices.has("rt2")).toBe(false);
    env.commands.redo();
    expect(env.s().topology.devices.has("rt2")).toBe(true);
  });
});

describe("グループにする・解除(SPEC 7.5)", () => {
  it("選んでいる機器でグループを作って選び、知らせる", () => {
    const store = createTopologyStore(testCatalog);
    store.getState().openText(specExample);
    const onGroupCreated = vi.fn();
    const commands = createEditCommands({
      store,
      clipboard: { readClipboardText: async () => "", writeClipboardText: async () => {} },
      isTextInputFocused: () => false,
      textCommand: vi.fn(),
      onGroupCreated,
    });
    expect(commands.group()).toBe(false);
    store.getState().setSelection({ devices: ["rt1", "srv1"], links: [] });
    expect(commands.group()).toBe(true);
    const group = store.getState().topology.groups[0];
    expect(group.members).toEqual(["rt1", "srv1"]);
    expect(store.getState().selection.group).toBe(group.uid);
    expect(onGroupCreated).toHaveBeenCalledWith(group.uid);
  });

  it("選んでいるグループを消し、機器の選択は残す", () => {
    const env = setup();
    expect(env.commands.ungroup()).toBe(false);
    env.s().setSelection({ devices: ["rt1"], links: [] });
    env.commands.group();
    expect(env.commands.ungroup()).toBe(true);
    expect(env.s().topology.groups).toEqual([]);
    expect(env.s().topology.devices.has("rt1")).toBe(true);
    expect(env.s().selection).toEqual({ devices: ["rt1"], links: [] });
  });
});
