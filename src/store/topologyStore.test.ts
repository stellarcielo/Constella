import { describe, expect, it } from "vitest";
import { testCatalog } from "../core/testFixtures";
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
});
