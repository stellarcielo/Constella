// アプリ全体で使うファイル操作。platform・ストア・ダイアログをつなぐ。

import { askDialog } from "../components/Dialog/dialogs";
import { platform } from "../platform";
import { topologyStore, uiStore } from "../store";
import { createFileCommands } from "./files";

export const fileCommands = createFileCommands({
  platform,
  store: topologyStore,
  resetView(viewport) {
    const ui = uiStore.getState();
    const { issues, yamlErrors } = topologyStore.getState();
    ui.setMode("select");
    ui.requestView({ viewport });
    // 開いたファイルにエラーがあれば、問題パネルを開く(1-9 Q3)
    if (issues.some((i) => i.severity === "error")) ui.setProblemsOpen(true);
    // 構文エラーはエディタでしか直せないので、エディタを表示する
    if (yamlErrors.length > 0) ui.setView({ showYaml: true });
  },
  async askUnsaved(fileName) {
    const choice = await askDialog({
      title: `「${fileName}」への変更を保存しますか?`,
      message: "保存しないと、変更は失われます。",
      actions: [
        { value: "discard", label: "保存しない" },
        { value: "save", label: "保存", primary: true },
      ],
    });
    return choice ?? "cancel";
  },
  async confirmSaveWithErrors() {
    const choice = await askDialog({
      title: "YAML にエラーがあります",
      message:
        "このまま保存しますか? 書いたとおりの内容で保存します。次に開いたとき、エディタで直せます。",
      actions: [{ value: "save", label: "このまま保存", primary: true }],
    });
    return choice === "save";
  },
  async showError(title, message, details) {
    await askDialog({
      title,
      message,
      details,
      actions: [{ value: "ok", label: "OK", primary: true }],
      cancelLabel: null,
    });
  },
});

export { documentName } from "./files";
