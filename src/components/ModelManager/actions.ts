// モデルの複製・編集・削除とアイコンの設定(パレットとモデルの管理画面で共有する。フェーズ3-4・SPEC 5.5)。
// モデルとアイコンをまとめたファイルへの書き出しと、そこからの取り込みもここで行う。

import {
  base64Bytes,
  type BundleIcon,
  copyModelId,
  type DeviceModel,
  iconsToWrite,
  type ImportModelStatus,
  MODEL_BUNDLE_FILE_NAME,
  modelBundleText,
  modelFormFromText,
  modelImageIcon,
  parseIconRef,
  parseModelBundle,
  planModelImport,
  type Role,
  setModelIcon,
} from "../../core";
import { ROLE_LABELS } from "../../icons/roles";
import { builtinCatalog, builtinModelText } from "../../library";
import { platform } from "../../platform";
import { basename } from "../../platform/types";
import { iconsStore, topologyStore, userModelsStore } from "../../store";
import type { UserModelFile } from "../../store/userModels";
import { askDialog } from "../Dialog/dialogs";
import { openModelEditor } from "../ModelEditor/editorStore";

export async function showError(title: string, message: string, details?: string[]): Promise<void> {
  await askDialog({
    title,
    message,
    details,
    actions: [{ value: "ok", label: "OK", primary: true }],
    cancelLabel: null,
  });
}

/** 開いている図で、そのモデルを使っている台数 */
export function modelUsage(modelId: string): number {
  let count = 0;
  for (const device of topologyStore.getState().topology.devices.values()) {
    if (device.model === modelId) count++;
  }
  return count;
}

/** 既存のモデル(組み込み・ユーザー)を元に、新しいモデルを作る(フェーズ3-4 Q3) */
export function duplicateModel(model: DeviceModel): void {
  const { catalog } = topologyStore.getState();
  const { files } = userModelsStore.getState();
  const text = files.find((f) => f.model?.id === model.id)?.text ?? builtinModelText(model.id);
  const form = text === undefined ? undefined : modelFormFromText(text);
  if (!form) return;
  const used = (id: string) => catalog.has(id) || files.some((f) => f.model?.id === id);
  openModelEditor({ ...form, id: copyModelId(model.id, used) });
}

/** ユーザーモデルを、追加・編集のダイアログで編集する */
export function editModel(file: UserModelFile): void {
  const form = modelFormFromText(file.text);
  if (form) openModelEditor(form, file.file);
}

/**
 * 確かめてから、ユーザーモデルのファイルを消す(図で使っていれば、その台数を出す)。消したら true。
 * modelId は読めないファイルなら undefined
 */
export async function removeModelFile(file: string, modelId?: string): Promise<boolean> {
  const used = modelId === undefined ? 0 : modelUsage(modelId);
  const choice = await askDialog({
    title: `「${modelId ?? file}」を削除しますか?`,
    message:
      used > 0
        ? `このモデルは、開いている図で ${used} 台が使っています。図はそのままで、モデルが見つからないエラーが問題パネルに出ます。`
        : "ユーザーモデルのフォルダから、このモデルのファイルを削除します。",
    actions: [{ value: "remove", label: "削除", primary: true, danger: true }],
  });
  if (choice !== "remove") return false;
  try {
    await userModelsStore.getState().remove(file);
    return true;
  } catch (e) {
    await showError("削除できませんでした", `「${file}」を削除できませんでした。`, [String(e)]);
    return false;
  }
}

/** ユーザーモデルのアイコンだけを変えて保存する(ファイルのほかの書き方はそのまま。空なら role のアイコン) */
export async function setUserModelIcon(file: UserModelFile, icon: string): Promise<void> {
  const text = setModelIcon(file.text, icon);
  if (text === undefined) return;
  try {
    await userModelsStore.getState().save(file.file, text, file.file);
  } catch (e) {
    await showError("保存できませんでした", `「${file.file}」を保存できませんでした。`, [
      String(e),
    ]);
  }
}

/** 画像を選んでアイコンのフォルダに取り込み、そのファイル名を返す(キャンセル・失敗なら undefined) */
export async function importIconImage(): Promise<string | undefined> {
  try {
    return await iconsStore.getState().importImage();
  } catch (e) {
    await showError("画像を取り込めませんでした", e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

/** 確かめてから、アイコンのフォルダの画像を消す */
export async function removeIconImage(file: string): Promise<void> {
  const choice = await askDialog({
    title: `画像「${file}」を削除しますか?`,
    message: "アイコンのフォルダから、この画像を削除します。",
    actions: [{ value: "remove", label: "削除", primary: true, danger: true }],
  });
  if (choice !== "remove") return;
  try {
    await iconsStore.getState().remove(file);
  } catch (e) {
    await showError("削除できませんでした", `「${file}」を削除できませんでした。`, [String(e)]);
  }
}

/** 今のアイコンの説明 */
export function iconDescription(
  icon: string,
  role: Role,
  images: ReadonlyMap<string, string>,
): string {
  const ref = icon === "" || icon === role ? undefined : parseIconRef(icon);
  if (!ref) return `${ROLE_LABELS[role]}のアイコン(既定)`;
  if (ref.kind === "builtin") return `組み込みの「${ROLE_LABELS[ref.role]}」のアイコン`;
  return images.has(ref.file)
    ? `画像 ${ref.file}`
    : `画像 ${ref.file}(見つからないので、${ROLE_LABELS[role]}のアイコンで表示しています)`;
}

/** data: URL の中身(base64) */
const dataUrlBase64 = (url: string) => url.slice(url.indexOf(",") + 1);

/**
 * 選んだユーザーモデルと、それが使う画像を 1 つのファイルに書き出す(SPEC 5.5)。
 * 書き出したら true(キャンセル・失敗なら false)
 */
export async function exportModelBundle(files: readonly UserModelFile[]): Promise<boolean> {
  const { images } = iconsStore.getState();
  const icons: BundleIcon[] = [];
  for (const { text } of files) {
    const file = modelImageIcon(text);
    const url = file === undefined ? undefined : images.get(file);
    if (file !== undefined && url !== undefined && !icons.some((i) => i.file === file)) {
      icons.push({ file, base64: dataUrlBase64(url) });
    }
  }
  const text = modelBundleText({ models: files.map(({ file, text }) => ({ file, text })), icons });
  try {
    const path = await platform.chooseSavePath(MODEL_BUNDLE_FILE_NAME, "models");
    if (path === null) return false;
    await platform.writeTextFile(path, text);
    return true;
  } catch (e) {
    await showError("書き出せませんでした", "モデルを書き出せませんでした。", [String(e)]);
    return false;
  }
}

/**
 * まとめたファイルを選び、中身の一覧を確かめてから取り込む(SPEC 5.5)。
 * 中身の違う同じ ID のモデルがあれば、上書きするか飛ばすかを選ぶ
 */
export async function importModelBundle(): Promise<void> {
  let picked: { path: string; text: string } | null;
  try {
    picked = await platform.openTextFile("models");
  } catch (e) {
    await showError("読み込めませんでした", "ファイルを読み込めませんでした。", [String(e)]);
    return;
  }
  if (!picked) return;
  const name = basename(picked.path);
  const parsed = parseModelBundle(picked.text);
  if (!parsed.ok) {
    await showError("読み込めませんでした", `「${name}」を読み込めませんでした。${parsed.error}。`);
    return;
  }

  const plan = planModelImport(parsed.bundle, {
    models: userModelsStore
      .getState()
      .files.map((f) => ({ file: f.file, text: f.text, id: f.model?.id })),
    builtinIds: new Set(builtinCatalog().keys()),
    icons: new Map(
      [...iconsStore.getState().images].map(([file, url]) => [file, dataUrlBase64(url)]),
    ),
  });
  const ids = (status: ImportModelStatus) =>
    plan.models.filter((m) => m.status === status).map((m) => m.id ?? m.file);
  const details: string[] = [];
  const list = (label: string, items: string[]) => {
    if (items.length > 0) details.push(`${label}: ${items.join("、")}`);
  };
  list("新しいモデル", ids("new"));
  list("中身が違うモデル", ids("changed"));
  list("今と同じモデル(何もしません)", ids("same"));
  list(
    "組み込みのモデルを置き換えるモデル",
    plan.models.flatMap((m) => (m.replacesBuiltin && m.id !== undefined ? [m.id] : [])),
  );
  for (const m of plan.models) {
    if (m.status === "invalid")
      details.push(`読めないモデル(取り込みません): ${m.file}(${m.reason})`);
  }
  for (const i of plan.icons) {
    if (i.status === "renamed") details.push(`名前を変えて取り込む画像: ${i.from} → ${i.file}`);
    else if (i.from !== i.file) details.push(`中身が同じ今の画像を使う: ${i.from} → ${i.file}`);
  }
  for (const problem of parsed.problems) details.push(`取り込めない項目: ${problem}`);

  const changed = ids("changed").length > 0;
  const message = `「${name}」に、モデルが ${parsed.bundle.models.length} 個、画像が ${parsed.bundle.icons.length} 個あります。`;
  if (ids("new").length === 0 && !changed) {
    await askDialog({
      title: "取り込むモデルはありません",
      message,
      details,
      actions: [{ value: "ok", label: "OK", primary: true }],
      cancelLabel: null,
    });
    return;
  }
  const choice = await askDialog({
    title: "モデルを取り込みますか?",
    message,
    details,
    actions: changed
      ? [
          { value: "skip", label: "重なるものは飛ばす" },
          { value: "overwrite", label: "上書きして取り込む", primary: true },
        ]
      : [{ value: "import", label: "取り込む", primary: true }],
  });
  if (choice === null) return;

  const models = plan.models.filter(
    (m) => m.status === "new" || (m.status === "changed" && choice === "overwrite"),
  );
  try {
    // モデルが画像をすぐ使えるように、画像を先に書く
    await iconsStore
      .getState()
      .addImages(
        iconsToWrite(plan, models).map((i) => ({ file: i.file, data: base64Bytes(i.base64) })),
      );
    await userModelsStore.getState().saveAll(models.map((m) => ({ file: m.target, text: m.text })));
  } catch (e) {
    await showError("取り込めませんでした", "モデルを取り込めませんでした。", [String(e)]);
  }
}
