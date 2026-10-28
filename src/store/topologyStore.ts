// トポロジのストア(SPEC 8.1 の「唯一の正」)。
// 編集はすべて edit() を通す。フェーズ2の Undo/Redo はここに履歴を足す。

import { enableMapSet, produce } from "immer";
import { createStore } from "zustand/vanilla";
import {
  addDevice,
  createEmptyTopology,
  type Issue,
  type ModelCatalog,
  moveDevices,
  type Position,
  removeDevices,
  removeLinks,
  type Topology,
  validateTopology,
  type YamlBase,
} from "../core";

enableMapSet();

export interface Selection {
  devices: string[];
  links: string[];
}

export interface TopologyState {
  topology: Topology;
  /** 開いた(または最後に保存した)YAML。保存時にコメントを残すために使う */
  base?: YamlBase;
  catalog: ModelCatalog;
  issues: Issue[];
  /** 未保存の変更があるか */
  dirty: boolean;
  selection: Selection;

  /** すべての編集はここを通す */
  edit(recipe: (draft: Topology) => void): void;
  addDevice(modelId: string, position: Position): string;
  moveDevices(positions: Iterable<[string, Position]>): void;
  deleteDevices(ids: string[]): void;
  deleteSelection(): void;
  setSelection(selection: Selection): void;
}

export type TopologyStore = ReturnType<typeof createTopologyStore>;

const EMPTY_SELECTION: Selection = { devices: [], links: [] };

export function createTopologyStore(catalog: ModelCatalog) {
  const initial = createEmptyTopology();
  return createStore<TopologyState>()((set, get) => ({
    topology: initial,
    catalog,
    issues: validateTopology(initial, catalog),
    dirty: false,
    selection: EMPTY_SELECTION,

    edit(recipe) {
      const { topology, catalog, base } = get();
      const next = produce(topology, recipe);
      if (next === topology) return;
      // 消えた要素を選択から外す
      const { selection } = get();
      const devices = selection.devices.filter((id) => next.devices.has(id));
      const links = selection.links.filter((id) => next.links.some((l) => l.id === id));
      set({
        topology: next,
        issues: validateTopology(next, catalog, base),
        dirty: true,
        selection: sameSelection(selection, { devices, links }) ? selection : { devices, links },
      });
    },

    addDevice(modelId, position) {
      let id = "";
      get().edit((t) => {
        id = addDevice(t, { model: modelId, position }, get().catalog);
      });
      return id;
    },

    moveDevices(positions) {
      const list = [...positions];
      const { layout } = get().topology;
      // 位置が変わっていなければ編集にしない(クリックだけで未保存にならないように)
      const changed = list.filter(([id, p]) => {
        const cur = layout.get(id);
        return !cur || cur.x !== Math.round(p.x) || cur.y !== Math.round(p.y);
      });
      if (changed.length === 0) return;
      get().edit((t) => moveDevices(t, changed));
    },

    deleteDevices(ids) {
      if (ids.length === 0) return;
      get().edit((t) => removeDevices(t, ids));
    },

    deleteSelection() {
      const { devices, links } = get().selection;
      if (devices.length === 0 && links.length === 0) return;
      get().edit((t) => {
        removeLinks(t, links);
        removeDevices(t, devices);
      });
    },

    setSelection(selection) {
      if (!sameSelection(get().selection, selection)) set({ selection });
    },
  }));
}

function sameSelection(a: Selection, b: Selection): boolean {
  return sameItems(a.devices, b.devices) && sameItems(a.links, b.links);
}

function sameItems(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
