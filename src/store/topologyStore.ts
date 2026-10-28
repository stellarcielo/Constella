// トポロジのストア(SPEC 8.1 の「唯一の正」)。今の YAML 文字列も持ち、GUI と YAML エディタを同期する(SPEC 8章)。
// - GUI の編集はすべて edit() を通す。編集のたびに YAML を作り直し(コメントを残す)、
//   読み直して問題の位置を今の文字列にそろえる
// - YAML エディタの内容は setYamlDraft() で受け取り、commitYamlDraft() で読み込む(エディタが 300ms 待ってから呼ぶ)
// - YAML に構文エラーがある間、図は最後に正しく読めた状態のまま。その間の GUI の編集は確認してから当てる
// - 取り消し・やり直し(SPEC 7.4): GUI の編集 1 回、エディタの内容の読み込み 1 回(300ms の区切り)が 1 ステップ

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
export type YamlOrigin = "gui" | "yaml" | "file" | "history";

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
  canUndo: boolean;
  canRedo: boolean;

  /** ファイルを開いた(または新規)。構文エラーがあっても開き、エディタで直せるようにする */
  openText(text: string, filePath?: string): void;
  newDocument(): void;
  /** text を filePath に保存した */
  markSaved(filePath: string, text: string): void;
  /** エディタの今の内容(読み込みは commitYamlDraft で) */
  setYamlDraft(text: string): void;
  /** 打ち込み中の内容を読み込んで図に反映する */
  commitYamlDraft(): void;

  /**
   * すべての GUI の編集はここを通す。
   * coalesce が直前の編集と同じで 1 秒以内なら、取り消しの 1 ステップにまとめる(矢印キーの移動など)
   */
  edit(recipe: (draft: Topology) => void, options?: EditOptions): void;
  /** 取り消す。構文エラーがあれば、最初は最後に正しく読めた状態に戻すだけ */
  undo(): void;
  redo(): void;
  addDevice(modelId: string, position: Position): string;
  moveDevices(positions: Iterable<[string, Position]>, options?: EditOptions): void;
  deleteDevices(ids: string[]): void;
  addLink(a: Endpoint, b: Endpoint): string;
  /** デバイスID を変える。使えない ID ならその理由を返す。選択も新しい ID に付け替える */
  renameDevice(oldId: string, newId: string): string | undefined;
  /** 指定したデバイスとリンクを削除する(デバイスにつながるリンクも消える) */
  deleteElements(elements: Partial<Selection>): void;
  deleteSelection(): void;
  setSelection(selection: Selection): void;
}

export interface EditOptions {
  coalesce?: string;
}

export interface TopologyStoreOptions {
  /** YAML に構文エラーがある間に GUI で編集しようとしたら呼ぶ。true なら GUI の内容で上書きする(SPEC 8.3) */
  confirmOverwrite?(): Promise<boolean>;
}

export type TopologyStore = ReturnType<typeof createTopologyStore>;

const EMPTY_SELECTION: Selection = { devices: [], links: [] };
export const EMPTY_YAML = "constella: 1\n";
/** 取り消せるステップの数 */
const HISTORY_LIMIT = 200;
/** この時間内に同じ種類の編集が続いたら、取り消しの 1 ステップにまとめる */
const COALESCE_MS = 1000;

/** 取り消し・やり直しで戻す状態 */
interface Snapshot {
  topology: Topology;
  base?: YamlBase;
  yamlText: string;
  yamlIssues: Issue[];
}

export function createTopologyStore(catalog: ModelCatalog, options: TopologyStoreOptions = {}) {
  let confirming = false;
  let past: Snapshot[] = [];
  let future: Snapshot[] = [];
  let lastCoalesce: { key: string; time: number } | undefined;
  /**
   * 最後に正しく読めた YAML 文字列(構文エラーの間も、取り消しの状態として使う)。
   * 構文エラーのあるファイルを開いた直後など、まだ無ければ undefined
   */
  let validText: string | undefined = EMPTY_YAML;

  return createStore<TopologyState>()((set, get) => {
    /** 今の(最後に正しく読めた)状態。正しく読めた状態がまだ無ければ undefined */
    const snapshot = (): Snapshot | undefined => {
      const { topology, base, yamlIssues } = get();
      return validText === undefined
        ? undefined
        : { topology, base, yamlText: validText, yamlIssues };
    };

    const updateHistoryFlags = () =>
      set({
        canUndo: past.length > 0 || (get().yamlErrors.length > 0 && validText !== undefined),
        canRedo: future.length > 0,
      });

    /** 変更前の状態を履歴に積む。新しい編集をしたら、やり直しの履歴は消える */
    const record = (coalesce?: string) => {
      const now = Date.now();
      const merge =
        coalesce !== undefined &&
        lastCoalesce?.key === coalesce &&
        now - lastCoalesce.time < COALESCE_MS;
      lastCoalesce = coalesce === undefined ? undefined : { key: coalesce, time: now };
      future = [];
      const current = snapshot();
      if (merge || !current) return;
      past.push(current);
      if (past.length > HISTORY_LIMIT) past.shift();
    };

    const resetHistory = () => {
      past = [];
      future = [];
      lastCoalesce = undefined;
    };

    /** 履歴の状態をそのまま戻す(識別子や選択も元どおりになる) */
    const restore = (s: Snapshot) => {
      validText = s.yamlText;
      set({
        topology: s.topology,
        base: s.base,
        yamlIssues: s.yamlIssues,
        yamlText: s.yamlText,
        yamlOrigin: "history",
        yamlDraft: undefined,
        yamlErrors: [],
        issues: computeIssues(s.topology, catalog, s.base, s.yamlIssues),
        dirty: s.yamlText !== get().savedText,
        selection: keepExisting(get().selection, s.topology),
      });
    };

    /** YAML 文字列を読み込んで図に反映する。構文エラーなら図はそのまま */
    const applyText = (text: string, origin: YamlOrigin) => {
      const { topology, base, yamlIssues, savedText, selection } = get();
      const parsed = parseTopology(text, { catalog });
      // エディタで書き換えたら、やり直しの履歴は消える。正しく読めたときだけ取り消しのステップにする
      if (origin === "yaml") {
        if (parsed.ok) record();
        else future = [];
      }
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
      validText = text;
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

    /** 構文エラーのある YAML を捨てて、最後に正しく読めた文字列(無ければ今の図から作った文字列)に戻す */
    const discardInvalidYaml = () => {
      const { topology, base } = get();
      applyText(validText ?? serializeTopology(topology, base).text, "history");
      updateHistoryFlags();
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
      canUndo: false,
      canRedo: false,

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
        resetHistory();
        validText = undefined;
        applyText(text, "file");
        updateHistoryFlags();
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
        updateHistoryFlags();
      },

      undo() {
        // 打ち込み中の内容を 1 ステップにしてから取り消す
        get().commitYamlDraft();
        if (get().yamlErrors.length > 0) {
          // 正しく読めた状態がまだ無ければ(構文エラーのファイルを開いた直後)、戻す先が無い
          if (validText === undefined) return;
          discardInvalidYaml();
        } else {
          const prev = past.pop();
          const current = snapshot();
          if (!prev || !current) return;
          future.push(current);
          restore(prev);
        }
        lastCoalesce = undefined;
        updateHistoryFlags();
      },

      redo() {
        get().commitYamlDraft();
        const current = snapshot();
        const next = current && future.pop();
        if (!current || !next) return;
        past.push(current);
        restore(next);
        lastCoalesce = undefined;
        updateHistoryFlags();
      },

      edit(recipe, editOptions = {}) {
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
            get().edit(recipe, editOptions);
          });
          return;
        }
        const { topology, base, selection, savedText } = get();
        const next = produce(topology, recipe);
        if (next === topology) return;
        record(editOptions.coalesce);
        const written = serializeTopology(next, base);
        // 書き出した YAML を読み直して、問題の位置を今の文字列にそろえる
        const rebased = rebaseOnText(written.text, next, catalog);
        const nextBase = rebased?.base ?? written.base;
        const yamlIssues = rebased?.fileIssues ?? get().yamlIssues;
        validText = written.text;
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
        updateHistoryFlags();
      },

      addDevice(modelId, position) {
        let id = "";
        get().edit((t) => {
          id = addDevice(t, { model: modelId, position }, get().catalog);
        });
        return id;
      },

      moveDevices(positions, moveOptions) {
        const list = [...positions];
        const { layout } = get().topology;
        // 位置が変わっていなければ編集にしない(クリックだけで未保存にならないように)
        const changed = list.filter(([id, p]) => {
          const cur = layout.get(id);
          return !cur || cur.x !== Math.round(p.x) || cur.y !== Math.round(p.y);
        });
        if (changed.length === 0) return;
        get().edit((t) => moveDevices(t, changed), moveOptions);
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
