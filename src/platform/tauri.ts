// Tauri(デスクトップアプリ)版。ファイルは公式プラグイン dialog / fs で扱う。
// ファイル選択画面で選んだパスは、その場で fs の読み書きの許可範囲に加わる(再起動すると消える)。

import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ImageFormat, MenuCommands, Platform, RecentFileItem } from "./types";

const FILTERS = [{ name: "Constella トポロジ(YAML)", extensions: ["yaml", "yml"] }];
const IMAGE_FILTERS: Record<ImageFormat, { name: string; extensions: string[] }[]> = {
  svg: [{ name: "SVG 画像", extensions: ["svg"] }],
  png: [{ name: "PNG 画像", extensions: ["png"] }],
};

// メニューの「最近使った項目を開く」(setupMenu で作り、setRecentFiles で中身を入れ替える)
let recentMenu: Submenu | undefined;
let recentCommands: Pick<MenuCommands, "openRecent" | "clearRecent"> | undefined;
let recentFiles: RecentFileItem[] = [];
/** 入れ替えは 1 回ずつ順に行う(続けて呼ばれても、新旧の項目が混ざらないように) */
let recentUpdate: Promise<void> = Promise.resolve();

function refreshRecentMenu(): Promise<void> {
  recentUpdate = recentUpdate
    .then(fillRecentMenu)
    .catch((e: unknown) => console.error("「最近使った項目を開く」を更新できませんでした", e));
  return recentUpdate;
}

async function fillRecentMenu(): Promise<void> {
  const menu = recentMenu;
  const commands = recentCommands;
  if (!menu || !commands) return;
  const files = recentFiles;
  const items = [];
  for (const file of files) {
    items.push(
      await MenuItem.new({ text: file.label, action: () => commands.openRecent(file.path) }),
    );
  }
  if (files.length > 0) items.push(await PredefinedMenuItem.new({ item: "Separator" }));
  // 一覧が空なら押せない(macOS の標準のアプリと同じ)
  items.push(
    await MenuItem.new({
      text: "メニューを消去",
      enabled: files.length > 0,
      action: commands.clearRecent,
    }),
  );
  for (const item of await menu.items()) await menu.remove(item);
  await menu.append(items);
}

export const tauriPlatform: Platform = {
  hasNativeMenu: true,

  async openTextFile() {
    const path = await open({ multiple: false, directory: false, filters: FILTERS });
    if (typeof path !== "string") return null;
    return { path, text: await readTextFile(path) };
  },

  readTextFile(path) {
    // 以前に選んだファイルの許可は、persisted-scope プラグインが再起動後も保っている
    return readTextFile(path);
  },

  async chooseSavePath(defaultName) {
    return save({ defaultPath: defaultName, filters: FILTERS });
  },

  async writeTextFile(path, text) {
    await writeTextFile(path, text);
  },

  async chooseExportPath(defaultName, format) {
    return save({ defaultPath: defaultName, filters: IMAGE_FILTERS[format] });
  },

  async writeBinaryFile(path, data) {
    await writeFile(path, data);
  },

  setTitle(title) {
    void getCurrentWindow().setTitle(title);
  },

  readClipboardText() {
    return readText();
  },

  async writeClipboardText(text) {
    await writeText(text);
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
    recentMenu = await Submenu.new({ text: "最近使った項目を開く", items: [] });
    recentCommands = commands;
    const file = await Submenu.new({
      text: "ファイル",
      items: [
        await command("新規", "CmdOrCtrl+N", commands.newFile),
        await command("開く…", "CmdOrCtrl+O", commands.open),
        recentMenu,
        await separator(),
        await command("保存", "CmdOrCtrl+S", commands.save),
        await command("別名で保存…", "CmdOrCtrl+Shift+S", commands.saveAs),
        await separator(),
        await command("SVG として書き出す…", "CmdOrCtrl+E", commands.exportSvg),
        await command("PNG として書き出す…", "CmdOrCtrl+Shift+E", commands.exportPng),
        await separator(),
        // ウィンドウを閉じる要求になるので、guardClose の確認が働く
        await PredefinedMenuItem.new({ item: "CloseWindow", text: "閉じる" }),
      ],
    });
    // 取り消す・やり直すはアプリ全体の操作につなぐ。カット・コピー・ペーストは入力欄で使う標準のもの
    // (図のコピー・ペーストはショートカットで扱う。フェーズ2-2 Q4)
    const edit = await Submenu.new({
      text: "編集",
      items: [
        await command("取り消す", "CmdOrCtrl+Z", commands.undo),
        await command("やり直す", "CmdOrCtrl+Shift+Z", commands.redo),
        await separator(),
        await PredefinedMenuItem.new({ item: "Cut", text: "カット" }),
        await PredefinedMenuItem.new({ item: "Copy", text: "コピー" }),
        await PredefinedMenuItem.new({ item: "Paste", text: "ペースト" }),
        await PredefinedMenuItem.new({ item: "SelectAll", text: "すべてを選択" }),
      ],
    });
    const view = await Submenu.new({
      text: "表示",
      items: [
        // 表示レイヤー(フェーズ3-3)。ラベルの行とグループの枠をまとめて切り替える
        await command("すべてのレイヤー", "CmdOrCtrl+0", () => commands.showLayer("all")),
        await command("L1(物理)", "CmdOrCtrl+1", () => commands.showLayer("l1")),
        await command("L2(データリンク)", "CmdOrCtrl+2", () => commands.showLayer("l2")),
        await command("L3(ネットワーク)", "CmdOrCtrl+3", () => commands.showLayer("l3")),
        await separator(),
        await PredefinedMenuItem.new({ item: "Fullscreen", text: "フルスクリーンにする" }),
      ],
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
    await refreshRecentMenu();
  },

  setRecentFiles(files) {
    recentFiles = files;
    return refreshRecentMenu();
  },
};
