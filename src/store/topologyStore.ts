// トポロジのストア(SPEC 8.1 の「唯一の正」)。
// 編集はすべて edit() を通す。フェーズ2の Undo/Redo はここに履歴を足す。

import { enableMapSet, produce } from "immer";
import { createStore } from "zustand/vanilla";
import {
  addDevice,
  addLink,
  checkDeviceId,
  createEmptyTopology,
  type Endpoint,
  ifNameKey,
  type Issue,
  type ModelCatalog,
  moveDevices,
  type Position,
  removeDevices,
  removeLinks,
  renameDevice,
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
  /** 開いているファイルのパス。新規(まだ保存していない)なら undefined */
  filePath?: string;
  /** ファイルを読んだときの問題(未知のキー、不正な値など) */
  fileIssues: Issue[];
  /** 表示する問題 = ファイル由来の問題(対象が残っているもの) + 検証の問題 */
  issues: Issue[];
  /** 未保存の変更があるか */
  dirty: boolean;
  selection: Selection;

  /** ファイルを開いた(または新規)。未保存の印と選択を消す */
  loadDocument(doc: {
    topology: Topology;
    base?: YamlBase;
    filePath?: string;
    fileIssues?: Issue[];
  }): void;
  newDocument(): void;
  /** 保存した。次回の保存は base に差分を当てる */
  markSaved(filePath: string, base: YamlBase): void;

  /** すべての編集はここを通す */
  edit(recipe: (draft: Topology) => void): void;
  addDevice(modelId: string, position: Position): string;
  moveDevices(positions: Iterable<[string, Position]>): void;
  deleteDevices(ids: string[]): void;
  addLink(a: Endpoint, b: Endpoint): string;
  /** デバイスID を変える。使えない ID ならその理由を返す。選択も新しい ID に付け替える */
  renameDevice(oldId: string, newId: string): string | undefined;
  /** 指定したデバイスとリンクを削除する(デバイスにつながるリンクも消える) */
  deleteElements(elements: Partial<Selection>): void;
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
    fileIssues: [],
    issues: validateTopology(initial, catalog),
    dirty: false,
    selection: EMPTY_SELECTION,

    loadDocument({ topology, base, filePath, fileIssues = [] }) {
      set({
        topology,
        base,
        filePath,
        fileIssues,
        issues: computeIssues(topology, get().catalog, base, fileIssues),
        dirty: false,
        selection: EMPTY_SELECTION,
      });
    },

    newDocument() {
      get().loadDocument({ topology: createEmptyTopology() });
    },

    markSaved(filePath, base) {
      set({ filePath, base, dirty: false });
    },

    edit(recipe) {
      const { topology, catalog, base, fileIssues } = get();
      const next = produce(topology, recipe);
      if (next === topology) return;
      // 消えた要素を選択から外す
      const { selection } = get();
      const devices = selection.devices.filter((id) => next.devices.has(id));
      const links = selection.links.filter((id) => next.links.some((l) => l.id === id));
      set({
        topology: next,
        issues: computeIssues(next, catalog, base, fileIssues),
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

    addLink(a, b) {
      let id = "";
      get().edit((t) => {
        id = addLink(t, a, b, get().catalog);
      });
      return id;
    },

    renameDevice(oldId, newId) {
      if (oldId === newId) return undefined;
      const error = checkDeviceId(get().topology, newId, oldId);
      if (error) return error;
      const wasSelected = get().selection.devices.includes(oldId);
      get().edit((t) => renameDevice(t, oldId, newId));
      if (wasSelected) {
        const { selection } = get();
        get().setSelection({ ...selection, devices: [...selection.devices, newId] });
      }
      return undefined;
    },

    deleteElements({ devices = [], links = [] }) {
      if (devices.length === 0 && links.length === 0) return;
      get().edit((t) => {
        removeLinks(t, links);
        removeDevices(t, devices);
      });
    },

    deleteSelection() {
      get().deleteElements(get().selection);
    },

    setSelection(selection) {
      if (!sameSelection(get().selection, selection)) set({ selection });
    },
  }));
}

function computeIssues(
  t: Topology,
  catalog: ModelCatalog,
  base: YamlBase | undefined,
  fileIssues: Issue[],
): Issue[] {
  return [...fileIssues.filter((i) => targetExists(i, t)), ...validateTopology(t, catalog, base)];
}

/**
 * 問題の対象がまだあるか。GUI で削除したデバイスやリンクの、ファイル由来の問題は出さない。
 * (GUI で値を直した項目の問題は、保存したファイルを開き直すまで残る)
 */
function targetExists(issue: Issue, t: Topology): boolean {
  const target = issue.target;
  switch (target.kind) {
    // layout の不正な値は、デバイスを消しても YAML に残る(保存処理は解釈できた座標しか消さない)
    case "document":
    case "layout":
      return true;
    case "device":
      return t.devices.has(target.id);
    case "interface": {
      const device = t.devices.get(target.device);
      const key = ifNameKey(target.name);
      return !!device && [...device.interfaces.keys()].some((name) => ifNameKey(name) === key);
    }
    case "link":
      return t.links.some((l) => l.id === target.id);
    case "group":
      return target.index < t.groups.length;
  }
}

function sameSelection(a: Selection, b: Selection): boolean {
  return sameItems(a.devices, b.devices) && sameItems(a.links, b.links);
}

function sameItems(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
