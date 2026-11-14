// 右クリックのメニュー(SPEC 7.6)。キャンバスの右クリックで uiStore に入れた状態から、body に出す。
// 画面からはみ出さない位置に出し、上下キー・Enter で選べる。Esc・メニューの外のクリック・スクロールで閉じる。

import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editCommands } from "../../commands";
import { type MenuTarget, topologyStore, uiStore, useTopology, useUi } from "../../store";
import {
  contextMenuItems,
  isSeparator,
  type MenuAction,
  type MenuItem,
  selectedBendKeys,
  selectedLabelKeys,
} from "./menus";
import "./ContextMenu.css";

/** 画面の端から離す量 */
const MARGIN = 8;

export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  // 開き直すたびに、位置と選んでいる項目を最初からにする
  return menu ? <MenuPopup key={`${menu.x},${menu.y},${menu.target.kind}`} /> : null;
}

function MenuPopup() {
  const menu = useUi((s) => s.contextMenu);
  const topology = useTopology((s) => s.topology);
  const selection = useTopology((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu?.x ?? 0, top: menu?.y ?? 0 });
  const [active, setActive] = useState(-1);

  // 右下に出し、はみ出すなら左・上に寄せる
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !menu) return;
    const { width, height } = el.getBoundingClientRect();
    const left =
      menu.x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, menu.x - width) : menu.x;
    const top =
      menu.y + height + MARGIN > window.innerHeight
        ? Math.max(MARGIN, window.innerHeight - height - MARGIN)
        : menu.y;
    setPosition({ left, top });
    el.focus();
  }, [menu]);

  useEffect(() => {
    const close = () => uiStore.getState().closeContextMenu();
    const closeOutside = (e: Event) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) close();
    };
    window.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("wheel", closeOutside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("wheel", closeOutside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  if (!menu) return null;
  const entries = contextMenuItems(menu.target, topology, selection);
  const run = (item: MenuItem) => {
    uiStore.getState().closeContextMenu();
    runMenuAction(item.action, menu.target);
  };
  /** 上下キーで、使える項目だけを順に選ぶ */
  const step = (delta: number) => {
    const usable = entries.flatMap((e, i) => (!isSeparator(e) && e.enabled ? [i] : []));
    if (usable.length === 0) return;
    const at = usable.indexOf(active);
    const next = at < 0 ? (delta > 0 ? 0 : usable.length - 1) : at + delta;
    setActive(usable[(next + usable.length) % usable.length]);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // キャンバスのキー操作(delete キー・C など)に回さない
    e.stopPropagation();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const entry = entries[active];
      if (entry && !isSeparator(entry) && entry.enabled) run(entry);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      uiStore.getState().closeContextMenu();
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      tabIndex={-1}
      style={position}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        isSeparator(entry) ? (
          <div key={i} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={["context-menu-item", i === active && "active", entry.danger && "danger"]
              .filter(Boolean)
              .join(" ")}
            disabled={!entry.enabled}
            onClick={() => run(entry)}
            onMouseEnter={() => setActive(entry.enabled ? i : -1)}
            onMouseLeave={() => setActive(-1)}
          >
            <span>{entry.label}</span>
            {entry.shortcut && <span className="context-menu-shortcut">{entry.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

function runMenuAction(action: MenuAction, target: MenuTarget): void {
  const store = topologyStore.getState();
  const { topology, selection } = store;
  switch (action) {
    case "connect": {
      const device = selection.devices.find((id) => topology.devices.has(id));
      if (device !== undefined) uiStore.getState().startConnect(device);
      break;
    }
    case "copy":
      void editCommands.copy();
      break;
    case "cut":
      void editCommands.cut();
      break;
    case "group":
      editCommands.group();
      break;
    case "ungroup":
      editCommands.ungroup();
      break;
    case "delete":
      store.deleteSelection();
      break;
    case "straighten":
      store.resetBends(selectedBendKeys(topology, selection.links));
      break;
    case "resetLabels":
      store.resetLabels(selectedLabelKeys(topology, selection.links));
      break;
    case "paste":
      void editCommands.paste(target.kind === "pane" ? target.at : undefined);
      break;
    case "selectAll":
      editCommands.selectAll();
      break;
    case "autoArrange":
      void store.autoArrange().then(() => uiStore.getState().requestView({}));
      break;
    case "resetAllLabels":
      store.resetLabels();
      break;
  }
}
