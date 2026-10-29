// 組み込みモデル(src/library/models/*.yaml)をビルド時にアプリへ埋め込み、カタログにする。
// Vite の import.meta.glob を使うので src/core には置かない。

import {
  buildCatalog,
  type DeviceModel,
  type ModelCatalog,
  type ModelIssue,
  parseModelDefinition,
} from "../core";

const files = import.meta.glob<string>("./models/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface ModelFileProblem {
  /** 例: `generic-router-4.yaml` */
  file: string;
  issues: ModelIssue[];
}

export interface BuiltinModels {
  models: DeviceModel[];
  /** 問題(警告を含む)のあったファイル。組み込みモデルではテストで 0 件を保証する */
  problems: ModelFileProblem[];
}

export function loadBuiltinModels(): BuiltinModels {
  const models: DeviceModel[] = [];
  const problems: ModelFileProblem[] = [];
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.replace("./models/", "");
    const result = parseModelDefinition(text);
    if (result.issues.length > 0) problems.push({ file, issues: result.issues });
    if (result.ok) models.push(result.model);
  }
  return { models, problems };
}

/** 組み込みモデルだけのカタログ。ユーザーモデルは buildCatalog に後から渡す(store/index.ts) */
export function builtinCatalog(): ModelCatalog {
  return buildCatalog(loadBuiltinModels().models);
}

/** 組み込みモデルの定義の YAML(ポートは連番のパターンのまま)。複製して作るときに使う */
export function builtinModelText(id: string): string | undefined {
  for (const text of Object.values(files)) {
    const result = parseModelDefinition(text);
    if (result.ok && result.model.id === id) return text;
  }
  return undefined;
}
