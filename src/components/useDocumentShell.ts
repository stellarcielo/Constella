// 文書まわりのアプリ全体の処理: ウィンドウタイトル、メニューバー、閉じる前の確認、
// メニューバーが無い環境(ブラウザ)での保存などのショートカット。

import { useEffect } from "react";
import { documentName, editCommands, exportCommands, fileCommands } from "../commands";
import { platform } from "../platform";
import { topologyStore, useTopology } from "../store";

export function useDocumentShell(): void {
  const filePath = useTopology((s) => s.filePath);
  const dirty = useTopology((s) => s.dirty);

  // タイトルにファイル名と未保存かどうかを出す(SPEC 10章)
  useEffect(() => {
    platform.setTitle(`${documentName(filePath)}${dirty ? "(未保存)" : ""} — Constella`);
  }, [filePath, dirty]);

  useEffect(() => {
    void platform.setupMenu({
      newFile: () => void fileCommands.newFile(),
      open: () => void fileCommands.open(),
      save: () => void fileCommands.save(),
      saveAs: () => void fileCommands.saveAs(),
      quit: () => void fileCommands.quit(),
      undo: () => editCommands.undo(),
      redo: () => editCommands.redo(),
      exportSvg: () => void exportCommands.exportImage("svg"),
      exportPng: () => void exportCommands.exportImage("png"),
    });
    return platform.guardClose({
      isDirty: () => topologyStore.getState().dirty,
      confirm: fileCommands.confirmClose,
    });
  }, []);

  useEffect(() => {
    if (platform.hasNativeMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void (e.shiftKey ? fileCommands.saveAs() : fileCommands.save());
      } else if (key === "o" && !e.shiftKey) {
        e.preventDefault();
        void fileCommands.open();
      } else if (key === "e") {
        e.preventDefault();
        void exportCommands.exportImage(e.shiftKey ? "png" : "svg");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
