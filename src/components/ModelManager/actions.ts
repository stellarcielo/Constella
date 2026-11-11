// モデルの複製・編集・削除とアイコンの設定(パレットとモデルの管理画面で共有する。フェーズ3-4・SPEC 5.5)。

import {
  copyModelId,
  type DeviceModel,
  modelFormFromText,
  parseIconRef,
  type Role,
  setModelIcon,
} from "../../core";
import { ROLE_LABELS } from "../../icons/roles";
import { builtinModelText } from "../../library";
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
