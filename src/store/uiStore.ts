// 画面の状態(モード、作りかけの接続、表示オプション)。トポロジとは分けて持ち、Undo の対象にしない。

import { createStore } from "zustand/vanilla";
import type { Endpoint, PortType, SourceRange, Viewport } from "../core";

export type Mode = "select" | "connect";

/** A 側で選んだポート */
export interface ChosenPort {
  endpoint: Endpoint;
  type?: PortType;
}

/** 接続の進み具合(SPEC 7.2) */
export type ConnectState =
  | { stage: "idle" }
  /** A 側のポートを選んでいる */
  | { stage: "pickA"; device: string }
  /** A 側のポートを選び終え、B 側のデバイスのクリックを待っている */
  | { stage: "awaitB"; a: ChosenPort }
  /** B 側のポートを選んでいる */
  | { stage: "pickB"; a: ChosenPort; device: string };

/** 表示オプション(SPEC 7.3)。YAML には書かず、アプリに覚えておく */
export interface ViewOptions {
  /** リンク両端の IF 名ラベルを表示する */
  showIfLabels: boolean;
  /** IF 名を長い形(GigabitEthernet0/1)で表示する */
  longIfNames: boolean;
  /** YAML エディタを表示する */
  showYaml: boolean;
  /** グループの枠を表示する(フェーズ3-1 Q5) */
  showGroups: boolean;
  /** IF 名ラベルの下に IP を表示する(フェーズ3-2 Q2) */
  showIp: boolean;
  /** IF 名ラベルの下に VLAN を表示する(フェーズ3-2 Q2) */
  showVlan: boolean;
}

export const DEFAULT_VIEW: ViewOptions = {
  showIfLabels: true,
  longIfNames: false,
  showYaml: true,
  showGroups: true,
  showIp: true,
  showVlan: true,
};
const VIEW_STORAGE_KEY = "constella.view";

export interface UiState {
  mode: Mode;
  connect: ConnectState;
  view: ViewOptions;
  /**
   * 表示位置を合わせる要求。id が変わるたびにキャンバスが合わせる。
   * viewport があればその位置に、focus があればそのデバイスが見えるように、
   * どちらも無ければ全体が見えるようにする
   */
  viewRequest: { id: number; viewport?: Viewport; focus?: string[] };
  /** 問題パネルを開いているか */
  problemsOpen: boolean;
  /** YAML エディタで、この範囲までスクロールして選択する要求(id が変わるたび) */
  editorJump: { id: number; range?: SourceRange };

  setMode(mode: Mode): void;
  toggleConnectMode(): void;
  /** 接続モードでデバイスをクリックした */
  clickDevice(id: string): void;
  /** ポートを選んだ。B 側まで選び終えたら、作るリンクの両端を返す */
  choosePort(port: ChosenPort): { a: Endpoint; b: Endpoint } | undefined;
  /** Esc。作りかけの接続があれば取りやめ、無ければ選択モードに戻る */
  escape(): void;
  /** 空いている所をクリックした。作りかけの接続を取りやめる */
  clickPane(): void;
  setView(view: Partial<ViewOptions>): void;
  requestView(request?: { viewport?: Viewport; focus?: string[] }): void;
  setProblemsOpen(open: boolean): void;
  jumpToYaml(range: SourceRange): void;
}

/** 表示オプションを覚えておく場所。テストでは渡さない */
export type ViewStorage = Pick<Storage, "getItem" | "setItem">;

const IDLE: ConnectState = { stage: "idle" };

export function createUiStore(storage?: ViewStorage) {
  const store = createStore<UiState>()((set, get) => ({
    mode: "select",
    connect: IDLE,
    view: loadView(storage),
    viewRequest: { id: 0 },
    problemsOpen: false,
    editorJump: { id: 0 },

    setMode(mode) {
      if (mode !== get().mode) set({ mode, connect: IDLE });
    },

    toggleConnectMode() {
      get().setMode(get().mode === "connect" ? "select" : "connect");
    },

    clickDevice(id) {
      const { mode, connect } = get();
      if (mode !== "connect") return;
      switch (connect.stage) {
        case "idle":
        case "pickA":
          set({ connect: { stage: "pickA", device: id } });
          break;
        case "awaitB":
        case "pickB":
          set({ connect: { stage: "pickB", a: connect.a, device: id } });
          break;
      }
    },

    choosePort(port) {
      const { connect } = get();
      if (connect.stage === "pickA") {
        set({ connect: { stage: "awaitB", a: port } });
        return undefined;
      }
      if (connect.stage === "pickB") {
        set({ connect: IDLE });
        return { a: connect.a.endpoint, b: port.endpoint };
      }
      return undefined;
    },

    escape() {
      const { mode, connect } = get();
      if (connect.stage !== "idle") set({ connect: IDLE });
      else if (mode === "connect") set({ mode: "select" });
    },

    clickPane() {
      if (get().connect.stage !== "idle") set({ connect: IDLE });
    },

    setView(view) {
      set({ view: { ...get().view, ...view } });
    },

    requestView(request = {}) {
      set({ viewRequest: { ...request, id: get().viewRequest.id + 1 } });
    },

    setProblemsOpen(problemsOpen) {
      set({ problemsOpen });
    },

    jumpToYaml(range) {
      set({ editorJump: { id: get().editorJump.id + 1, range } });
    },
  }));
  if (storage) {
    store.subscribe((state, prev) => {
      if (state.view === prev.view) return;
      try {
        storage.setItem(VIEW_STORAGE_KEY, JSON.stringify(state.view));
      } catch {
        // 保存できなくても表示には影響しない
      }
    });
  }
  return store;
}

function loadView(storage?: ViewStorage): ViewOptions {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(VIEW_STORAGE_KEY) ?? "null");
    if (typeof saved !== "object" || saved === null) return DEFAULT_VIEW;
    const { showIfLabels, longIfNames, showYaml, showGroups, showIp, showVlan } = saved as Record<
      string,
      unknown
    >;
    return {
      showIfLabels: typeof showIfLabels === "boolean" ? showIfLabels : DEFAULT_VIEW.showIfLabels,
      longIfNames: typeof longIfNames === "boolean" ? longIfNames : DEFAULT_VIEW.longIfNames,
      showYaml: typeof showYaml === "boolean" ? showYaml : DEFAULT_VIEW.showYaml,
      showGroups: typeof showGroups === "boolean" ? showGroups : DEFAULT_VIEW.showGroups,
      showIp: typeof showIp === "boolean" ? showIp : DEFAULT_VIEW.showIp,
      showVlan: typeof showVlan === "boolean" ? showVlan : DEFAULT_VIEW.showVlan,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}
