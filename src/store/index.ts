// アプリ全体で使うストアのインスタンスと React 用のフック。

import { useStore } from "zustand";
import { builtinCatalog } from "../library";
import { createTopologyStore, type TopologyState } from "./topologyStore";

export const topologyStore = createTopologyStore(builtinCatalog());

export function useTopology<T>(selector: (state: TopologyState) => T): T {
  return useStore(topologyStore, selector);
}

export type { Selection, TopologyState } from "./topologyStore";
