// 文書まわりのアプリ全体の処理: ウィンドウタイトル、メニューバー(最近使った項目を含む)、
// 閉じる前の確認、メニューバーが無い環境(ブラウザ)での保存などのショートカット。

import { useEffect } from "react";
import { documentName, editCommands, exportCommands, fileCommands } from "../commands";
import { platform } from "../platform";
import { recentFilesStore, topologyStore, uiStore, useTopology, VIEW_LAYERS } from "../store";
import { recentLabels } from "../store/recentFiles";

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
      openRecent: (path) => void fileCommands.openRecent(path),
      clearRecent: () => recentFilesStore.getState().clear(),
      showLayer: (layer) => uiStore.getState().setLayer(layer),
    });
    return platform.guardClose({
      isDirty: () => topologyStore.getState().dirty,
      confirm: fileCommands.confirmClose,
    });
  }, []);

  // メニューの「最近使った項目を開く」を、一覧が変わるたびに作り直す
  useEffect(() => {
    const update = (paths: string[]) => {
      const labels = recentLabels(paths);
      void platform.setRecentFiles(paths.map((path, i) => ({ path, label: labels[i] })));
    };
    update(recentFilesStore.getState().paths);
    return recentFilesStore.subscribe((state, prev) => {
      if (state.paths !== prev.paths) update(state.paths);
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
      } else if (/^[0-3]$/.test(key) && !e.shiftKey) {
        // 表示レイヤー: ⌘0 = すべて、⌘1〜⌘3 = L1〜L3
        e.preventDefault();
        uiStore.getState().setLayer(VIEW_LAYERS[Number(key)]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
