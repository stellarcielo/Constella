import { describe, expect, it } from "vitest";
import {
  addDevice,
  addLink,
  changeModel,
  checkDeviceId,
  modelChangeImpact,
  moveDevices,
  nextDeviceId,
  removeDevices,
  removeLinks,
  renameDevice,
  setDeviceGuest,
  setDeviceHost,
  setDeviceLabel,
  setDeviceRole,
  setDeviceVmid,
  updateInterface,
  updateLink,
  updateMeta,
} from "./edit";
import { parseTopology } from "./parse";
import { specExample, testCatalog } from "./testFixtures";
import { createEmptyTopology } from "./topology";
import type { Topology } from "./types";

function withDevices(...ids: string[]): Topology {
  const t = createEmptyTopology();
  for (const id of ids)
    t.devices.set(id, { id, uid: `uid-${id}`, interfaces: new Map(), extra: {} });
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
      uid: expect.any(String),
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

describe("addLink", () => {
  it("末尾に追加し、IF 名の表記をそろえる", () => {
    const t = example();
    const id = addLink(
      t,
      { device: "core-sw1", iface: "FastEthernet0/2" },
      { device: "isp", iface: "WAN2" },
      testCatalog,
    );
    const link = t.links[t.links.length - 1];
    expect(link.id).toBe(id);
    expect(link.a).toEqual({ device: "core-sw1", iface: "Fa0/2" });
    expect(link.b).toEqual({ device: "isp", iface: "WAN2" });
    expect(link.media).toBeUndefined();
  });

  it("フレキシブルデバイスの既存の IF は、その表記に合わせる", () => {
    const t = example();
    addLink(t, { device: "rt1", iface: "Gi0/2" }, { device: "isp", iface: "WAN" }, testCatalog);
    expect(t.links[t.links.length - 1].b).toEqual({ device: "isp", iface: "wan" });
  });
});

describe("checkDeviceId", () => {
  const t = withDevices("rt1", "sw1");

  it("空・規則違反・重複は理由を返す", () => {
    expect(checkDeviceId(t, "")).toBe("ID を入力してください");
    expect(checkDeviceId(t, "-x")).toContain("英数字で始まり");
    expect(checkDeviceId(t, "a b")).toContain("英数字で始まり");
    expect(checkDeviceId(t, "a:b")).toContain("英数字で始まり");
    expect(checkDeviceId(t, "sw1", "rt1")).toBe("「sw1」は既に使われています");
  });

  it("使える ID と、今の自分の ID は問題なし", () => {
    expect(checkDeviceId(t, "core-sw.1_a")).toBeUndefined();
    expect(checkDeviceId(t, "rt1", "rt1")).toBeUndefined();
  });
});

describe("renameDevice", () => {
  it("リンク・layout・グループの参照も書き換え、順序と uid は保つ", () => {
    const t = example();
    t.groups.push({ id: "g", members: ["rt1", "core-sw1"], extra: {} });
    const uid = t.devices.get("core-sw1")?.uid;
    renameDevice(t, "core-sw1", "dist-sw1");
    expect([...t.devices.keys()]).toEqual(["rt1", "dist-sw1", "srv1", "isp"]);
    expect(t.devices.get("dist-sw1")?.id).toBe("dist-sw1");
    expect(t.devices.get("dist-sw1")?.uid).toBe(uid);
    expect([...t.layout.keys()]).toEqual(["rt1", "dist-sw1"]);
    expect(t.links.map((l) => [l.a?.device, l.b?.device])).toEqual([
      ["rt1", "isp"],
      ["rt1", "dist-sw1"],
      ["dist-sw1", "srv1"],
    ]);
    expect(t.groups[0].members).toEqual(["rt1", "dist-sw1"]);
  });

  it("自分自身へのリンクは両端とも書き換える", () => {
    const t = withDevices("sw1");
    addLink(t, { device: "sw1", iface: "a" }, { device: "sw1", iface: "b" }, testCatalog);
    renameDevice(t, "sw1", "sw9");
    expect([t.links[0].a?.device, t.links[0].b?.device]).toEqual(["sw9", "sw9"]);
  });

  it("使えない ID なら例外にして何も変えない", () => {
    const t = withDevices("rt1", "sw1");
    expect(() => renameDevice(t, "rt1", "sw1")).toThrow("既に使われています");
    expect(() => renameDevice(t, "rt1", "bad id")).toThrow();
    expect([...t.devices.keys()]).toEqual(["rt1", "sw1"]);
  });
});

describe("setDeviceLabel / setDeviceRole", () => {
  it("ラベルの設定と削除", () => {
    const t = example();
    setDeviceLabel(t, "srv1", "Web");
    expect(t.devices.get("srv1")?.label).toBe("Web");
    setDeviceLabel(t, "srv1", "");
    expect(t.devices.get("srv1")).not.toHaveProperty("label");
  });

  it("モデルと同じ role は書かない", () => {
    const t = example();
    setDeviceRole(t, "rt1", "firewall", testCatalog);
    expect(t.devices.get("rt1")?.role).toBe("firewall");
    setDeviceRole(t, "rt1", "router", testCatalog);
    expect(t.devices.get("rt1")).not.toHaveProperty("role");
    setDeviceRole(t, "isp", "cloud", testCatalog);
    expect(t.devices.get("isp")?.role).toBe("cloud");
  });

  it("YAML で解釈できなかった値は、GUI で設定したら捨てる", () => {
    const t = example();
    const srv1 = t.devices.get("srv1");
    if (!srv1) throw new Error();
    srv1.extra.role = "toaster";
    setDeviceRole(t, "srv1", "pc", testCatalog);
    expect(srv1.extra).toEqual({});
  });
});

describe("modelChangeImpact / changeModel", () => {
  it("新しいモデルに無いポートのリンクと IF 設定を洗い出す", () => {
    const t = example();
    const impact = modelChangeImpact(t, "core-sw1", "generic-router-4", testCatalog);
    // core-sw1 は Gi0/1(rt1 と)と Fa0/1(srv1 と)を使い、Gi0/1 に設定がある。ルーターには Gi0/1 はあるが Fa0/1 は無い
    expect(impact.links.map((l) => l.b?.device)).toEqual(["srv1"]);
    expect(impact.interfaces).toEqual([]);
  });

  it("フレキシブルやモデルなしに変えるときは何も無くならない", () => {
    const t = example();
    expect(modelChangeImpact(t, "core-sw1", "generic-cloud", testCatalog)).toEqual({
      links: [],
      interfaces: [],
    });
    expect(modelChangeImpact(t, "core-sw1", undefined, testCatalog)).toEqual({
      links: [],
      interfaces: [],
    });
  });

  it("削除する場合: リンクと IF 設定を消し、role はモデルに合わせる", () => {
    const t = example();
    updateInterface(t, "srv1", "eth1", { description: "backup" }, testCatalog);
    changeModel(t, "srv1", "generic-router-4", testCatalog, { removeLostPorts: true });
    const srv1 = t.devices.get("srv1");
    expect(srv1?.model).toBe("generic-router-4");
    expect(srv1?.interfaces.size).toBe(0);
    expect(t.links.some((l) => l.b?.device === "srv1")).toBe(false);
  });

  it("残す場合: リンクと IF 設定はそのまま(検証でエラーになる)", () => {
    const t = example();
    changeModel(t, "srv1", "generic-router-4", testCatalog, { removeLostPorts: false });
    expect(t.links.some((l) => l.b?.device === "srv1")).toBe(true);
  });

  it("モデルなしにするときは今の role を引き継ぐ(Q3)", () => {
    const t = example();
    changeModel(t, "rt1", undefined, testCatalog, { removeLostPorts: true });
    const rt1 = t.devices.get("rt1");
    expect(rt1).not.toHaveProperty("model");
    expect(rt1?.role).toBe("router");
  });

  it("モデルを付けると role はモデルに合わせる", () => {
    const t = example();
    changeModel(t, "isp", "generic-router-4", testCatalog, { removeLostPorts: false });
    expect(t.devices.get("isp")).not.toHaveProperty("role");
  });

  it("残った IF 名は新しいモデルの表記にそろえる", () => {
    const t = withDevices("x", "y");
    addLink(t, { device: "x", iface: "GI0/1" }, { device: "y", iface: "a" }, testCatalog);
    updateInterface(t, "x", "GI0/2", { description: "d" }, testCatalog);
    changeModel(t, "x", "generic-router-4", testCatalog, { removeLostPorts: true });
    expect(t.links[0].a).toEqual({ device: "x", iface: "Gi0/1" });
    expect([...(t.devices.get("x")?.interfaces.keys() ?? [])]).toEqual(["Gi0/2"]);
  });
});

describe("updateInterface", () => {
  it("設定が無ければ IF 名をそろえて作る", () => {
    const t = example();
    updateInterface(t, "rt1", "GigabitEthernet0/2", { description: "spare" }, testCatalog);
    expect(t.devices.get("rt1")?.interfaces.get("Gi0/2")).toEqual({
      description: "spare",
      extra: {},
    });
  });

  it("既存の設定を書き換え、空の項目は消す", () => {
    const t = example();
    updateInterface(
      t,
      "core-sw1",
      "Gi0/1",
      { mode: "access", vlan: 10, ip: ["192.0.2.1/30"] },
      testCatalog,
    );
    updateInterface(t, "core-sw1", "gi0/1", { ip: [], description: "" }, testCatalog);
    expect(t.devices.get("core-sw1")?.interfaces.get("Gi0/1")).toEqual({
      mode: "access",
      vlan: 10,
      extra: {},
    });
  });

  it("すべて空になったら設定ごと消す", () => {
    const t = example();
    updateInterface(t, "core-sw1", "Gi0/1", { description: undefined }, testCatalog);
    expect(t.devices.get("core-sw1")?.interfaces.size).toBe(0);
  });
});

describe("updateLink / updateMeta", () => {
  it("リンクの media と label", () => {
    const t = example();
    const id = t.links[0].id;
    updateLink(t, id, { media: "fiber", label: "uplink" });
    expect(t.links[0]).toMatchObject({ media: "fiber", label: "uplink" });
    updateLink(t, id, { media: undefined, label: "" });
    expect(t.links[0]).not.toHaveProperty("media");
    expect(t.links[0]).not.toHaveProperty("label");
  });

  it("meta のタイトルと説明", () => {
    const t = example();
    updateMeta(t, { title: "新しいタイトル", description: undefined });
    expect(t.meta).toEqual({ title: "新しいタイトル", extra: {} });
  });
});

describe("ゲストとホスト(SPEC 4.6・7.1)", () => {
  const guests = () => {
    const result = parseTopology(
      `constella: 1
devices:
  pve1: { model: generic-hypervisor-4 }
  vm1: { model: generic-vm, host: pve1, vmid: 100 }
  ct1: { model: generic-container, host: pve1 }
  sw1: { model: generic-l2switch-24 }
`,
      { catalog: testCatalog },
    );
    if (!result.ok) throw new Error();
    return result.topology;
  };

  it("ハイパーバイザは hv、ゲストは role ではなく種類で採番する", () => {
    const t = createEmptyTopology();
    expect(nextDeviceId(t, "hypervisor")).toBe("hv1");
    expect(nextDeviceId(t, "firewall", "vm")).toBe("vm1");
    expect(nextDeviceId(t, "server", "container")).toBe("ct1");
  });

  it("addDevice: モデルの guest で採番し、host を書く", () => {
    const t = guests();
    const at = { x: 0, y: 0 };
    expect(addDevice(t, { model: "generic-hypervisor-4", position: at }, testCatalog)).toBe("hv1");
    const id = addDevice(t, { model: "generic-vm", host: "pve1", position: at }, testCatalog);
    expect(id).toBe("vm2");
    expect(t.devices.get(id)?.host).toBe("pve1");
    // host だけでもゲスト(VM)になる
    expect(
      addDevice(t, { model: "generic-server-2", host: "pve1", position: at }, testCatalog),
    ).toBe("vm3");
  });

  it("ホストを削除しても、ゲストは残して host を外す(フェーズ4-1 Q3)", () => {
    const t = guests();
    removeDevices(t, ["pve1"]);
    expect([...t.devices.keys()]).toEqual(["vm1", "ct1", "sw1"]);
    expect(t.devices.get("vm1")?.host).toBeUndefined();
    expect(t.devices.get("vm1")?.vmid).toBe(100);
  });

  it("ホストの ID を変えると、ゲストの host も書き換える", () => {
    const t = guests();
    renameDevice(t, "pve1", "pve-a");
    expect(t.devices.get("vm1")?.host).toBe("pve-a");
    expect(t.devices.get("ct1")?.host).toBe("pve-a");
  });

  it("host・guest・vmid の設定。モデルと同じ guest は書かない", () => {
    const t = guests();
    setDeviceHost(t, "sw1", "pve1");
    expect(t.devices.get("sw1")?.host).toBe("pve1");
    setDeviceHost(t, "sw1", undefined);
    expect(t.devices.get("sw1")).not.toHaveProperty("host");

    setDeviceGuest(t, "ct1", "vm", testCatalog);
    expect(t.devices.get("ct1")?.guest).toBe("vm");
    setDeviceGuest(t, "ct1", "container", testCatalog);
    expect(t.devices.get("ct1")).not.toHaveProperty("guest");

    setDeviceVmid(t, "ct1", 200);
    expect(t.devices.get("ct1")?.vmid).toBe(200);
    setDeviceVmid(t, "ct1", undefined);
    expect(t.devices.get("ct1")).not.toHaveProperty("vmid");
  });
});
