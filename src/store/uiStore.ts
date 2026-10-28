// 画面の状態(モードと作りかけの接続)。トポロジとは分けて持ち、Undo の対象にしない。

import { createStore } from "zustand/vanilla";
import type { Endpoint, PortType } from "../core";

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

export interface UiState {
  mode: Mode;
  connect: ConnectState;

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
}

const IDLE: ConnectState = { stage: "idle" };

export function createUiStore() {
  return createStore<UiState>()((set, get) => ({
    mode: "select",
    connect: IDLE,

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
  }));
}
