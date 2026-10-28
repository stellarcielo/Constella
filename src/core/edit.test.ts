import { describe, expect, it } from "vitest";
import { addDevice, moveDevices, nextDeviceId, removeDevices, removeLinks } from "./edit";
import { parseTopology } from "./parse";
import { specExample, testCatalog } from "./testFixtures";
import { createEmptyTopology } from "./topology";
import type { Topology } from "./types";

function withDevices(...ids: string[]): Topology {
  const t = createEmptyTopology();
  for (const id of ids) t.devices.set(id, { id, interfaces: new Map(), extra: {} });
  return t;
}

function example(): Topology {
  const result = parseTopology(specExample, { catalog: testCatalog });
  if (!result.ok) throw new Error();
  return result.topology;
}

describe("nextDeviceId", () => {
  it("role ごとのプレフィックス", () => {
    const t = createEmptyTopology();
    expect(nextDeviceId(t, "router")).toBe("rt1");
    expect(nextDeviceId(t, "l2switch")).toBe("sw1");
    expect(nextDeviceId(t, "l3switch")).toBe("l3sw1");
    expect(nextDeviceId(t, "firewall")).toBe("fw1");
    expect(nextDeviceId(t, "server")).toBe("srv1");
    expect(nextDeviceId(t, "pc")).toBe("pc1");
    expect(nextDeviceId(t, "ap")).toBe("ap1");
    expect(nextDeviceId(t, "cloud")).toBe("cloud1");
    expect(nextDeviceId(t, "generic")).toBe("dev1");
  });

  it("今ある最大の番号 + 1(空き番号は使わない)", () => {
    expect(nextDeviceId(withDevices("rt1", "rt3"), "router")).toBe("rt4");
  });

  it("プレフィックス + 数字の形でない ID は無視する", () => {
    expect(nextDeviceId(withDevices("rt1a", "rt", "core-rt9", "l3sw5"), "router")).toBe("rt1");
    expect(nextDeviceId(withDevices("l3sw5"), "l2switch")).toBe("sw1");
  });
});

describe("addDevice", () => {
  it("モデルの role で採番し、座標を整数に丸める", () => {
    const t = withDevices("rt1");
    const id = addDevice(
      t,
      { model: "generic-router-4", position: { x: 10.4, y: 20.6 } },
      testCatalog,
    );
    expect(id).toBe("rt2");
    expect(t.devices.get("rt2")).toEqual({
      id: "rt2",
      model: "generic-router-4",
      interfaces: new Map(),
      extra: {},
    });
    expect(t.layout.get("rt2")).toEqual({ x: 10, y: 21 });
  });

  it("モデルと同じ role は書かない。違う role は書く", () => {
    const t = createEmptyTopology();
    addDevice(
      t,
      { model: "generic-router-4", role: "router", position: { x: 0, y: 0 } },
      testCatalog,
    );
    addDevice(
      t,
      { model: "generic-router-4", role: "firewall", position: { x: 0, y: 0 } },
      testCatalog,
    );
    expect(t.devices.get("rt1")?.role).toBeUndefined();
    expect(t.devices.get("fw1")?.role).toBe("firewall");
  });

  it("モデル無しのデバイス", () => {
    const t = createEmptyTopology();
    expect(addDevice(t, { role: "cloud", position: { x: 0, y: 0 } }, testCatalog)).toBe("cloud1");
    expect(addDevice(t, { position: { x: 0, y: 0 } }, testCatalog)).toBe("dev1");
  });

  it("未知のモデルは generic として採番する", () => {
    const t = createEmptyTopology();
    expect(addDevice(t, { model: "nope", position: { x: 0, y: 0 } }, testCatalog)).toBe("dev1");
  });
});

describe("moveDevices", () => {
  it("座標を更新し、存在しないデバイスは無視する", () => {
    const t = example();
    moveDevices(t, [
      ["rt1", { x: 1.2, y: 2.7 }],
      ["srv1", { x: 5, y: 6 }],
      ["ghost", { x: 0, y: 0 }],
    ]);
    expect(t.layout.get("rt1")).toEqual({ x: 1, y: 3 });
    expect(t.layout.get("srv1")).toEqual({ x: 5, y: 6 });
    expect(t.layout.has("ghost")).toBe(false);
  });
});

describe("removeDevices", () => {
  it("接続していたリンクと layout も削除する", () => {
    const t = example();
    removeDevices(t, ["rt1"]);
    expect(t.devices.has("rt1")).toBe(false);
    expect(t.layout.has("rt1")).toBe(false);
    expect(t.links.map((l) => [l.a?.device, l.b?.device])).toEqual([["core-sw1", "srv1"]]);
  });

  it("グループのメンバーからも取り除く", () => {
    const t = withDevices("a", "b");
    t.groups.push({ id: "g", members: ["a", "b"], extra: {} });
    removeDevices(t, ["a"]);
    expect(t.groups[0].members).toEqual(["b"]);
  });

  it("複数まとめて削除する", () => {
    const t = example();
    removeDevices(t, ["srv1", "isp"]);
    expect([...t.devices.keys()]).toEqual(["rt1", "core-sw1"]);
    expect(t.links).toHaveLength(1);
  });
});

describe("removeLinks", () => {
  it("指定したリンクだけを削除する", () => {
    const t = example();
    const [first, ...rest] = t.links;
    removeLinks(t, [first.id]);
    expect(t.links).toEqual(rest);
  });
});
