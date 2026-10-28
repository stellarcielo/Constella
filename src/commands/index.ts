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
    ui.setMode("select");
    ui.requestView({ viewport });
    // 開いたファイルにエラーがあれば、問題パネルを開く(1-9 Q3)
    if (topologyStore.getState().issues.some((i) => i.severity === "error")) {
      ui.setProblemsOpen(true);
    }
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
