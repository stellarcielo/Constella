import { describe, expect, it } from "vitest";
import { createUiStore, DEFAULT_VIEW, type ViewStorage } from "./uiStore";

const gi00 = { endpoint: { device: "rt1", iface: "Gi0/0" }, type: "rj45" as const };
const eth0 = { endpoint: { device: "srv1", iface: "eth0" }, type: "rj45" as const };

function connecting() {
  const store = createUiStore();
  store.getState().setMode("connect");
  return store;
}

describe("uiStore: 接続モード", () => {
  it("最初は選択モード", () => {
    const s = createUiStore().getState();
    expect(s.mode).toBe("select");
    expect(s.connect).toEqual({ stage: "idle" });
  });

  it("選択モードではデバイスをクリックしても何も起きない", () => {
    const store = createUiStore();
    store.getState().clickDevice("rt1");
    expect(store.getState().connect).toEqual({ stage: "idle" });
  });

  it("A を選ぶ → B を選ぶ → リンクの両端を返して最初に戻る(Q2: 接続モードのまま)", () => {
    const store = connecting();
    const s = () => store.getState();
    s().clickDevice("rt1");
    expect(s().connect).toEqual({ stage: "pickA", device: "rt1" });
    expect(s().choosePort(gi00)).toBeUndefined();
    expect(s().connect).toEqual({ stage: "awaitB", a: gi00 });
    s().clickDevice("srv1");
    expect(s().connect).toEqual({ stage: "pickB", a: gi00, device: "srv1" });
    expect(s().choosePort(eth0)).toEqual({ a: gi00.endpoint, b: eth0.endpoint });
    expect(s().connect).toEqual({ stage: "idle" });
    expect(s().mode).toBe("connect");
  });

  it("ポートを選ぶ前に別のデバイスをクリックすると、そちらに切り替える", () => {
    const store = connecting();
    store.getState().clickDevice("rt1");
    store.getState().clickDevice("rt2");
    expect(store.getState().connect).toEqual({ stage: "pickA", device: "rt2" });
    store.getState().choosePort(gi00);
    store.getState().clickDevice("srv1");
    store.getState().clickDevice("srv2");
    expect(store.getState().connect).toEqual({ stage: "pickB", a: gi00, device: "srv2" });
  });

  it("Esc は作りかけの接続を取りやめ、もう一度押すと選択モードに戻る(Q3)", () => {
    const store = connecting();
    store.getState().clickDevice("rt1");
    store.getState().choosePort(gi00);
    store.getState().escape();
    expect(store.getState().connect).toEqual({ stage: "idle" });
    expect(store.getState().mode).toBe("connect");
    store.getState().escape();
    expect(store.getState().mode).toBe("select");
  });

  it("空いている所をクリックすると作りかけの接続を取りやめる(Q4)", () => {
    const store = connecting();
    store.getState().clickDevice("rt1");
    store.getState().choosePort(gi00);
    store.getState().clickPane();
    expect(store.getState().connect).toEqual({ stage: "idle" });
    expect(store.getState().mode).toBe("connect");
  });

  it("モードを切り替えると作りかけの接続は消える", () => {
    const store = connecting();
    store.getState().clickDevice("rt1");
    store.getState().toggleConnectMode();
    expect(store.getState().mode).toBe("select");
    expect(store.getState().connect).toEqual({ stage: "idle" });
  });
});

describe("uiStore: 表示オプション", () => {
  function memoryStorage(initial?: string): ViewStorage & { data: Map<string, string> } {
    const data = new Map<string, string>(initial ? [["constella.view", initial]] : []);
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
  }

  it("既定は IF 名ラベルを短い形で表示", () => {
    expect(createUiStore().getState().view).toEqual(DEFAULT_VIEW);
    expect(DEFAULT_VIEW).toEqual({
      showIfLabels: true,
      longIfNames: false,
      showYaml: true,
      showGroups: true,
      showIp: true,
      showVlan: true,
    });
  });

  it("変更すると保存し、次に作ったときに読み込む(Q4)", () => {
    const storage = memoryStorage();
    createUiStore(storage)
      .getState()
      .setView({ longIfNames: true, showGroups: false, showIp: false });
    const saved = {
      showIfLabels: true,
      longIfNames: true,
      showYaml: true,
      showGroups: false,
      showIp: false,
      showVlan: true,
    };
    expect(JSON.parse(storage.data.get("constella.view") ?? "")).toEqual(saved);
    expect(createUiStore(storage).getState().view).toEqual(saved);
  });

  it("保存された内容が壊れていたら既定値を使う", () => {
    expect(createUiStore(memoryStorage("{oops")).getState().view).toEqual(DEFAULT_VIEW);
    expect(createUiStore(memoryStorage('{"showIfLabels":"yes"}')).getState().view).toEqual(
      DEFAULT_VIEW,
    );
  });
});
