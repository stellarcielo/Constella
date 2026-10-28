// トポロジのストア(SPEC 8.1 の「唯一の正」)。今の YAML 文字列も持ち、GUI と YAML エディタを同期する(SPEC 8章)。
// - GUI の編集はすべて edit() を通す。編集のたびに YAML を作り直し(コメントを残す)、
//   読み直して問題の位置を今の文字列にそろえる
// - YAML エディタの内容は setYamlDraft() で受け取り、commitYamlDraft() で読み込む(エディタが 300ms 待ってから呼ぶ)
// - YAML に構文エラーがある間、図は最後に正しく読めた状態のまま。その間の GUI の編集は確認してから当てる
// フェーズ2の Undo/Redo はここに履歴を足す。

import { enableMapSet, produce } from "immer";
import { createStore } from "zustand/vanilla";
import {
  addDevice,
  addLink,
  adoptIdentity,
  checkDeviceId,
  createEmptyTopology,
  type Endpoint,
  ifNameKey,
  type Issue,
  type ModelCatalog,
  moveDevices,
  parseTopology,
  type Position,
  rebaseOnText,
  removeDevices,
  removeLinks,
  renameDevice,
  serializeTopology,
  type Topology,
  validateTopology,
  type YamlBase,
} from "../core";

enableMapSet();

export interface Selection {
  devices: string[];
  links: string[];
}

/** YAML 文字列を変えた出どころ。"yaml" はエディタ自身の内容なので、エディタに書き戻さない */
export type YamlOrigin = "gui" | "yaml" | "file";

export interface TopologyState {
  /** 最後に正しく読めた図。GUI の編集はここに当てる */
  topology: Topology;
  /** topology を書き出すときに差分を当てる YAML(今の文字列を読んだもの) */
  base?: YamlBase;
  catalog: ModelCatalog;
  /** 開いているファイルのパス。新規(まだ保存していない)なら undefined */
  filePath?: string;
  /** 今の YAML 文字列(エディタに出す内容)。構文エラーのときはエラーのある文字列。問題の位置はこの中の位置 */
  yamlText: string;
  yamlOrigin: YamlOrigin;
  /** 開いた・保存したときの文字列。これと違えば未保存 */
  savedText: string;
  /** エディタで打ち込んで、まだ読み込んでいない文字列 */
  yamlDraft?: string;
  /** yamlText の構文エラー。あれば図は最後に正しく読めた状態のまま */
  yamlErrors: Issue[];
  /** 今の YAML を読んだときの問題(未知のキー、不正な値など) */
  yamlIssues: Issue[];
  /** 表示する問題 = 構文エラー + YAML 由来の問題 + 検証の問題 */
  issues: Issue[];
  /** 未保存の変更があるか */
  dirty: boolean;
  selection: Selection;
  /** GUI の編集を取りやめた回数(キャンバスが動かしかけた機器を元の位置に戻すため) */
  rejectedEdits: number;

  /** ファイルを開いた(または新規)。構文エラーがあっても開き、エディタで直せるようにする */
  openText(text: string, filePath?: string): void;
  newDocument(): void;
  /** text を filePath に保存した */
  markSaved(filePath: string, text: string): void;
  /** エディタの今の内容(読み込みは commitYamlDraft で) */
  setYamlDraft(text: string): void;
  /** 打ち込み中の内容を読み込んで図に反映する */
  commitYamlDraft(): void;

  /** すべての GUI の編集はここを通す */
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

export interface TopologyStoreOptions {
  /** YAML に構文エラーがある間に GUI で編集しようとしたら呼ぶ。true なら GUI の内容で上書きする(SPEC 8.3) */
  confirmOverwrite?(): Promise<boolean>;
}

export type TopologyStore = ReturnType<typeof createTopologyStore>;

const EMPTY_SELECTION: Selection = { devices: [], links: [] };
export const EMPTY_YAML = "constella: 1\n";

export function createTopologyStore(catalog: ModelCatalog, options: TopologyStoreOptions = {}) {
  let confirming = false;

  return createStore<TopologyState>()((set, get) => {
    /** YAML 文字列を読み込んで図に反映する。構文エラーなら図はそのまま */
    const applyText = (text: string, origin: YamlOrigin) => {
      const { topology, base, yamlIssues, savedText, selection } = get();
      const parsed = parseTopology(text, { catalog });
      if (!parsed.ok) {
        set({
          yamlText: text,
          yamlOrigin: origin,
          yamlDraft: undefined,
          yamlErrors: parsed.issues,
          // 最後に正しく読めた図の問題は、位置が今の文字列と合わないので位置を外す
          issues: [
            ...parsed.issues,
            ...computeIssues(topology, catalog, base, yamlIssues).map((i) => ({
              ...i,
              range: undefined,
            })),
          ],
          dirty: text !== savedText,
        });
        return;
      }
      const adopted = adoptIdentity(topology, parsed);
      set({
        topology: adopted.topology,
        base: adopted.base,
        yamlIssues: adopted.issues,
        yamlText: text,
        yamlOrigin: origin,
        yamlDraft: undefined,
        yamlErrors: [],
        issues: computeIssues(adopted.topology, catalog, adopted.base, adopted.issues),
        dirty: text !== savedText,
        selection: keepExisting(selection, adopted.topology),
      });
    };

    /** 構文エラーのある YAML を捨てて、最後に正しく読めた図から作り直す */
    const discardInvalidYaml = () => {
      const { topology, base } = get();
      applyText(serializeTopology(topology, base).text, "gui");
    };

    const initial = parseTopology(EMPTY_YAML, { catalog });
    if (!initial.ok) throw new Error("unreachable");

    return {
      topology: initial.topology,
      base: initial.base,
      catalog,
      yamlText: EMPTY_YAML,
      yamlOrigin: "file",
      savedText: EMPTY_YAML,
      yamlErrors: [],
      yamlIssues: [],
      issues: validateTopology(initial.topology, catalog, initial.base),
      dirty: false,
      selection: EMPTY_SELECTION,
      rejectedEdits: 0,

      openText(text, filePath) {
        // 前のファイルの図や識別子は引き継がない
        set({
          topology: createEmptyTopology(),
          base: undefined,
          yamlIssues: [],
          filePath,
          savedText: text,
          selection: EMPTY_SELECTION,
        });
        applyText(text, "file");
      },

      newDocument() {
        get().openText(EMPTY_YAML);
      },

      markSaved(filePath, text) {
        set({ filePath, savedText: text, dirty: get().yamlText !== text });
      },

      setYamlDraft(text) {
        if (text !== get().yamlDraft) set({ yamlDraft: text });
      },

      commitYamlDraft() {
        const { yamlDraft, yamlText } = get();
        if (yamlDraft === undefined) return;
        if (yamlDraft === yamlText) set({ yamlDraft: undefined });
        else applyText(yamlDraft, "yaml");
      },

      edit(recipe) {
        // 打ち込み中の内容を先に読み込む(GUI の編集で上書きして消さないように)
        get().commitYamlDraft();
        if (get().yamlErrors.length > 0) {
          set({ rejectedEdits: get().rejectedEdits + 1 });
          if (confirming || !options.confirmOverwrite) return;
          confirming = true;
          void options.confirmOverwrite().then((ok) => {
            confirming = false;
            if (!ok) return;
            discardInvalidYaml();
            get().edit(recipe);
          });
          return;
        }
        const { topology, base, selection, savedText } = get();
        const next = produce(topology, recipe);
        if (next === topology) return;
        const written = serializeTopology(next, base);
        // 書き出した YAML を読み直して、問題の位置を今の文字列にそろえる
        const rebased = rebaseOnText(written.text, next, catalog);
        const nextBase = rebased?.base ?? written.base;
        const yamlIssues = rebased?.fileIssues ?? get().yamlIssues;
        set({
          topology: next,
          base: nextBase,
          yamlIssues,
          yamlText: written.text,
          yamlOrigin: "gui",
          issues: computeIssues(next, catalog, nextBase, yamlIssues),
          dirty: written.text !== savedText,
          selection: keepExisting(selection, next),
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
        if (wasSelected && get().topology.devices.has(newId)) {
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
    };
  });
}

function computeIssues(
  t: Topology,
  catalog: ModelCatalog,
  base: YamlBase | undefined,
  yamlIssues: Issue[],
): Issue[] {
  return [...yamlIssues.filter((i) => targetExists(i, t)), ...validateTopology(t, catalog, base)];
}

/**
 * 問題の対象がまだあるか。読み直しに失敗したとき(通常は起きない)に、
 * 削除したデバイスやリンクの古い問題を出さないための安全策。
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

/** 消えた要素を選択から外す */
function keepExisting(selection: Selection, t: Topology): Selection {
  const devices = selection.devices.filter((id) => t.devices.has(id));
  const links = selection.links.filter((id) => t.links.some((l) => l.id === id));
  return sameSelection(selection, { devices, links }) ? selection : { devices, links };
}

function sameSelection(a: Selection, b: Selection): boolean {
  return sameItems(a.devices, b.devices) && sameItems(a.links, b.links);
}

function sameItems(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
