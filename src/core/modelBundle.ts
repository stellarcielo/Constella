// モデルとアイコンをまとめたファイル(SPEC 5.5)。ユーザーモデルの YAML(書いたとおり)と、
// それが使うアイコンの画像(base64)を 1 つの YAML に入れ、別の Mac や人に渡せるようにする。
// 取り込むときは、今のユーザーモデル・画像と比べて、新しい・同じ・中身が違うに分ける。

import { isMap, isScalar, isSeq, parseDocument, stringify } from "yaml";
import { ICON_MAX_BYTES, isIconImageName, parseIconRef, uniqueIconName } from "./icons";
import { parseModelDefinition } from "./modelLibrary";
import { setModelIcon } from "./modelForm";

/** ファイルの先頭に書く印と、その版 */
export const MODEL_BUNDLE_KEY = "constella-models";
export const MODEL_BUNDLE_VERSION = 1;
/** 書き出すときの、ファイル名の初期値 */
export const MODEL_BUNDLE_FILE_NAME = "constella-models.yaml";

export interface BundleModel {
  /** ユーザーモデルのフォルダでのファイル名 */
  file: string;
  /** モデルの YAML(コメントも含めて書いたとおり) */
  text: string;
}

export interface BundleIcon {
  /** アイコンのフォルダでのファイル名 */
  file: string;
  /** 画像の中身(base64) */
  base64: string;
}

export interface ModelBundle {
  models: BundleModel[];
  icons: BundleIcon[];
}

/** 画像の中身(base64)をバイト列にする */
export function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** モデルが使う画像のアイコンのファイル名(組み込みのアイコン・アイコンなしなら undefined) */
export function modelImageIcon(text: string): string | undefined {
  const result = parseModelDefinition(text);
  const icon = result.ok ? result.model.icon : undefined;
  const ref = icon === undefined ? undefined : parseIconRef(icon);
  return ref?.kind === "image" ? ref.file : undefined;
}

/** 書き出す YAML の文字列。モデルの YAML は複数行のまま(| の形で)入れる */
export function modelBundleText(bundle: ModelBundle): string {
  const body = stringify(
    {
      [MODEL_BUNDLE_KEY]: MODEL_BUNDLE_VERSION,
      models: bundle.models.map(({ file, text }) => ({ file, text })),
      icons: bundle.icons.map(({ file, base64 }) => ({ file, data: base64 })),
    },
    { blockQuote: "literal", lineWidth: 0 },
  );
  return `# Constella のモデルとアイコン。モデルの管理画面の「読み込む…」で取り込めます\n${body}`;
}

export type ModelBundleParseResult =
  | {
      ok: true;
      bundle: ModelBundle;
      /** 読めなかった項目(取り込まない) */
      problems: string[];
    }
  | { ok: false; error: string };

/** まとめたファイルを読む。項目ごとの問題は problems に入れて、その項目だけ飛ばす */
export function parseModelBundle(text: string): ModelBundleParseResult {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return { ok: false, error: "YAML として読めません" };
  const root = doc.contents;
  const marker = isMap(root) ? root.get(MODEL_BUNDLE_KEY, true) : undefined;
  const version: unknown = isScalar(marker) ? marker.value : marker;
  if (!isMap(root) || marker === undefined) {
    return {
      ok: false,
      error: `Constella のモデルのファイルではありません(${MODEL_BUNDLE_KEY}: ${MODEL_BUNDLE_VERSION} がありません)`,
    };
  }
  if (version !== MODEL_BUNDLE_VERSION) {
    return {
      ok: false,
      error: `${MODEL_BUNDLE_KEY} の版「${String(version)}」には対応していません`,
    };
  }

  const problems: string[] = [];
  /** 文字の項目だけを持つ並び。並びでなければ空 */
  const entries = (key: string): Map<string, string>[] => {
    const seq = root.get(key, true);
    if (seq === undefined) return [];
    if (!isSeq(seq)) {
      problems.push(`${key} が並び(- で始まる項目)になっていません`);
      return [];
    }
    return seq.items.map((item) => {
      const fields = new Map<string, string>();
      if (!isMap(item)) return fields;
      for (const pair of item.items) {
        if (isScalar(pair.key) && isScalar(pair.value) && typeof pair.value.value === "string") {
          fields.set(String(pair.key.value), pair.value.value);
        }
      }
      return fields;
    });
  };

  const models: BundleModel[] = [];
  entries("models").forEach((fields, i) => {
    const file = fields.get("file");
    const text = fields.get("text");
    if (file === undefined || text === undefined) {
      problems.push(`models の ${i + 1} 番目に file と text がありません`);
    } else {
      models.push({ file, text });
    }
  });

  const icons: BundleIcon[] = [];
  entries("icons").forEach((fields, i) => {
    const file = fields.get("file");
    const data = fields.get("data")?.replace(/\s+/g, "");
    if (file === undefined || data === undefined) {
      problems.push(`icons の ${i + 1} 番目に file と data がありません`);
      return;
    }
    if (!isIconImageName(file) || /[\\/]/.test(file)) {
      problems.push(`${file} は、アイコンの画像のファイル名(.svg・.png)ではありません`);
      return;
    }
    let size: number;
    try {
      size = base64Bytes(data).length;
    } catch {
      problems.push(`${file} の中身(data)が読めません`);
      return;
    }
    if (size > ICON_MAX_BYTES) {
      problems.push(`${file} は 1 MB を超えているので取り込みません`);
      return;
    }
    icons.push({ file, base64: data });
  });

  return { ok: true, bundle: { models, icons }, problems };
}

/** 取り込むときの、モデルごとの扱い */
export type ImportModelStatus = "new" | "same" | "changed" | "invalid";

export interface ImportModel {
  /** まとめたファイルでのファイル名 */
  file: string;
  /** モデルの ID(読めなければ undefined) */
  id?: string;
  status: ImportModelStatus;
  /** 書き込むファイル名(同じ ID のユーザーモデルがあれば、そのファイル) */
  target: string;
  /** 書き込む YAML(画像の名前を付け替えたあと) */
  text: string;
  /** 組み込みのモデルを置き換える(同じ ID のユーザーモデルは無い) */
  replacesBuiltin?: boolean;
  /** 読めない理由 */
  reason?: string;
}

export interface ImportIcon {
  /** まとめたファイルでのファイル名 */
  from: string;
  /** アイコンのフォルダに書くファイル名 */
  file: string;
  base64: string;
  /**
   * same: 同じ中身の画像があるので書かない(名前が重なって別の名前の同じ画像を使うときは、from と file が違う)。
   * renamed: 中身の違う同じ名前の画像があるので名前を変える
   */
  status: "new" | "same" | "renamed";
}

export interface ImportPlan {
  models: ImportModel[];
  icons: ImportIcon[];
}

/** 今のユーザーモデル・組み込みのモデル・画像 */
export interface ImportCurrent {
  /** ユーザーモデルのファイル。id は読めたものだけ */
  models: readonly { file: string; text: string; id?: string }[];
  builtinIds: ReadonlySet<string>;
  /** 画像のファイル名 → 中身(base64) */
  icons: ReadonlyMap<string, string>;
}

/**
 * 取り込みの一覧を作る。画像は、同じ名前で中身も同じなら今の画像を使う。中身が違えば、同じ中身の画像が
 * 別の名前であればそれを使い、無ければ -2 などを付けて取り込む。名前が変わったら、その画像を使うモデルの
 * icon も書き換える。モデルは ID で今のユーザーモデルと比べる(中身が同じなら same)
 */
export function planModelImport(bundle: ModelBundle, current: ImportCurrent): ImportPlan {
  const used = new Set(current.icons.keys());
  const icons: ImportIcon[] = [];
  const renamed = new Map<string, string>();
  for (const icon of bundle.icons) {
    if (icons.some((i) => i.from === icon.file)) continue;
    const existing = current.icons.get(icon.file);
    if (existing === icon.base64) {
      icons.push({ from: icon.file, file: icon.file, base64: icon.base64, status: "same" });
      continue;
    }
    // 名前が重なっても、同じ中身の画像が別の名前であれば、それを使う(取り込み直したときに増やさない)
    const twin =
      existing === undefined
        ? undefined
        : [...current.icons].find(([, base64]) => base64 === icon.base64)?.[0];
    if (twin !== undefined) {
      renamed.set(icon.file, twin);
      icons.push({ from: icon.file, file: twin, base64: icon.base64, status: "same" });
      continue;
    }
    const file = existing === undefined ? icon.file : uniqueIconName(icon.file, (f) => used.has(f));
    used.add(file);
    if (file !== icon.file) renamed.set(icon.file, file);
    icons.push({
      from: icon.file,
      file,
      base64: icon.base64,
      status: file === icon.file ? "new" : "renamed",
    });
  }

  const models: ImportModel[] = [];
  const seen = new Set<string>();
  for (const { file, text } of bundle.models) {
    const result = parseModelDefinition(text);
    if (!result.ok) {
      const reason = result.issues.find((i) => i.severity === "error")?.message ?? "読めません";
      models.push({ file, status: "invalid", target: file, text, reason });
      continue;
    }
    const { id } = result.model;
    if (seen.has(id)) {
      models.push({
        file,
        id,
        status: "invalid",
        target: file,
        text,
        reason: "同じ ID が前にもあります",
      });
      continue;
    }
    seen.add(id);
    const image = modelImageIcon(text);
    const rename = image === undefined ? undefined : renamed.get(image);
    const next = rename === undefined ? text : (setModelIcon(text, rename) ?? text);
    const existing = current.models.find((m) => m.id === id);
    if (existing) {
      models.push({
        file,
        id,
        status: existing.text === next ? "same" : "changed",
        target: existing.file,
        text: next,
      });
    } else {
      models.push({
        file,
        id,
        status: "new",
        target: `${id}.yaml`,
        text: next,
        ...(current.builtinIds.has(id) ? { replacesBuiltin: true } : {}),
      });
    }
  }
  return { models, icons };
}

/** 書き込むモデルが使う画像のうち、書き込む必要のあるもの(今と同じ画像は除く) */
export function iconsToWrite(plan: ImportPlan, models: readonly ImportModel[]): ImportIcon[] {
  const needed = new Set(models.flatMap((m) => modelImageIcon(m.text) ?? []));
  return plan.icons.filter((i) => i.status !== "same" && needed.has(i.file));
}
