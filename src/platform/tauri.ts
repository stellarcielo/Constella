// Tauri(デスクトップアプリ)版。ファイルは公式プラグイン dialog / fs で扱う。
// ファイル選択画面で選んだパスは、その場で fs の読み書きの許可範囲に加わる(再起動すると消える)。

import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { MenuCommands, Platform } from "./types";

const FILTERS = [{ name: "Constella トポロジ(YAML)", extensions: ["yaml", "yml"] }];

export const tauriPlatform: Platform = {
  hasNativeMenu: true,

  async openTextFile() {
    const path = await open({ multiple: false, directory: false, filters: FILTERS });
    if (typeof path !== "string") return null;
    return { path, text: await readTextFile(path) };
  },

  async chooseSavePath(defaultName) {
    return save({ defaultPath: defaultName, filters: FILTERS });
  },

  async writeTextFile(path, text) {
    await writeTextFile(path, text);
  },

  setTitle(title) {
    void getCurrentWindow().setTitle(title);
  },

  guardClose({ isDirty, confirm }) {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        // 確認でキャンセルされたら閉じない(それ以外は閉じる)
        if (isDirty() && !(await confirm())) event.preventDefault();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  async closeWindow() {
    await getCurrentWindow().destroy();
  },

  async setupMenu(commands: MenuCommands) {
    const separator = () => PredefinedMenuItem.new({ item: "Separator" });
    const command = (text: string, accelerator: string, action: () => void) =>
      MenuItem.new({ text, accelerator, action });

    const app = await Submenu.new({
      text: "Constella",
      items: [
        await PredefinedMenuItem.new({ item: { About: null }, text: "Constella について" }),
        await separator(),
        await PredefinedMenuItem.new({ item: "Services", text: "サービス" }),
        await separator(),
        await PredefinedMenuItem.new({ item: "Hide", text: "Constella を隠す" }),
        await PredefinedMenuItem.new({ item: "HideOthers", text: "ほかを隠す" }),
        await PredefinedMenuItem.new({ item: "ShowAll", text: "すべてを表示" }),
        await separator(),
        // 標準の「終了」では未保存の確認ができないので、アプリ側で受ける
        await command("Constella を終了", "CmdOrCtrl+Q", commands.quit),
      ],
    });
    const file = await Submenu.new({
      text: "ファイル",
      items: [
        await command("新規", "CmdOrCtrl+N", commands.newFile),
        await command("開く…", "CmdOrCtrl+O", commands.open),
        await separator(),
        await command("保存", "CmdOrCtrl+S", commands.save),
        await command("別名で保存…", "CmdOrCtrl+Shift+S", commands.saveAs),
        await separator(),
        // ウィンドウを閉じる要求になるので、guardClose の確認が働く
        await PredefinedMenuItem.new({ item: "CloseWindow", text: "閉じる" }),
      ],
    });
    // 入力欄で使う標準の編集操作。キャンバスの取り消し・やり直しはフェーズ2で入れる
    const edit = await Submenu.new({
      text: "編集",
      items: [
        await PredefinedMenuItem.new({ item: "Undo", text: "取り消す" }),
        await PredefinedMenuItem.new({ item: "Redo", text: "やり直す" }),
        await separator(),
        await PredefinedMenuItem.new({ item: "Cut", text: "カット" }),
        await PredefinedMenuItem.new({ item: "Copy", text: "コピー" }),
        await PredefinedMenuItem.new({ item: "Paste", text: "ペースト" }),
        await PredefinedMenuItem.new({ item: "SelectAll", text: "すべてを選択" }),
      ],
    });
    const view = await Submenu.new({
      text: "表示",
      items: [await PredefinedMenuItem.new({ item: "Fullscreen", text: "フルスクリーンにする" })],
    });
    const windowMenu = await Submenu.new({
      text: "ウインドウ",
      items: [
        await PredefinedMenuItem.new({ item: "Minimize", text: "しまう" }),
        await PredefinedMenuItem.new({ item: "Maximize", text: "拡大/縮小" }),
        await separator(),
        await PredefinedMenuItem.new({ item: "BringAllToFront", text: "すべてを手前に移動" }),
      ],
    });
    const help = await Submenu.new({
      text: "ヘルプ",
      items: [await MenuItem.new({ text: "Constella ヘルプ(準備中)", enabled: false })],
    });

    const menu = await Menu.new({ items: [app, file, edit, view, windowMenu, help] });
    await menu.setAsAppMenu();
    await windowMenu.setAsWindowsMenuForNSApp();
    await help.setAsHelpMenuForNSApp();
  },
};
