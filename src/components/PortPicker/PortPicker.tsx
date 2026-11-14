// ポート選択ポップアップ(SPEC 7.2)。
// 種別ごとのグループ、使用中ポートのグレーアウトと接続先、検索欄、次の空きポート、
// フレキシブルデバイスでの IF 名の自由入力、A 側と種別が合わないポートの警告。
// 無線のポートは何本でもつなげるので、使用中でも選べる(SPEC 7.2)。
// キャンバス(React Flow)の重なりの層の中だと、あとに並ぶ YAML エディタなどに隠れるので、body に出す。

import { type KeyboardEvent, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  allowsManyLinks,
  endpointToString,
  expandIfName,
  firstFreePort,
  ifNameKey,
  isFlexibleDevice,
  listDevicePorts,
  PORT_TYPES,
  type PortEntry,
  type PortType,
  portTypesCompatible,
} from "../../core";
import { type ChosenPort, useTopology } from "../../store";
import { PORT_TYPE_LABELS } from "../portTypes";
import { PICKER_WIDTH, type PickerPosition } from "./placement";
import "./PortPicker.css";

export interface PortPickerProps {
  deviceId: string;
  side: "a" | "b";
  /** B 側を選ぶときの、A 側で選んだポート */
  peer?: ChosenPort;
  /** 表示位置と高さ(ウィンドウ座標。placement.ts で決める) */
  position: PickerPosition;
  onChoose(port: ChosenPort): void;
}

/** 選べる項目。既存のポートか、フレキシブルデバイスで新しく入力した IF 名 */
type Option = { kind: "port"; entry: PortEntry } | { kind: "new"; name: string };

/** 選べるポートか(空いているか、無線のように何本でもつなげるか) */
const available = (entry: PortEntry) => !entry.use || allowsManyLinks(entry.type);

export function PortPicker({ deviceId, side, peer, position, onChoose }: PortPickerProps) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const device = topology.devices.get(deviceId);
  const flexible = device ? isFlexibleDevice(device, catalog) : false;
  // bond・VLAN インターフェースには線をつながないので出さない(SPEC 4.6)
  const entries = useMemo(
    () =>
      device
        ? listDevicePorts(device, topology, catalog, undefined, peer?.endpoint).filter(
            (e) => !e.logical,
          )
        : [],
    [device, topology, catalog, peer],
  );

  const q = query.trim();
  const filtered = useMemo(() => {
    const lower = q.toLowerCase();
    if (lower === "") return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(lower) || expandIfName(e.name).toLowerCase().includes(lower),
    );
  }, [entries, q]);

  const exact = q === "" ? undefined : entries.find((e) => ifNameKey(e.name) === ifNameKey(q));
  const options: Option[] = [
    ...(flexible && q !== "" && !exact ? [{ kind: "new", name: q } as const] : []),
    ...filtered.filter(available).map((entry) => ({ kind: "port", entry }) as const),
  ];
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const activeOption = options[activeIndex];
  const nextFree = firstFreePort(entries);

  if (!device) return null;

  const choose = (option: Option) => {
    const iface = option.kind === "new" ? option.name : option.entry.name;
    const type = option.kind === "port" ? option.entry.type : undefined;
    onChoose(
      type
        ? { endpoint: { device: deviceId, iface }, type }
        : { endpoint: { device: deviceId, iface } },
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive(Math.min(Math.max(activeIndex + delta, 0), Math.max(options.length - 1, 0)));
    } else if (e.key === "Enter" && activeOption) {
      e.preventDefault();
      choose(activeOption);
    }
  };

  const groups = groupByType(filtered);
  const modelName = device.model ? (catalog.get(device.model)?.name ?? device.model) : undefined;

  return createPortal(
    <div
      className="port-picker"
      style={{
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width: PICKER_WIDTH,
        maxHeight: position.maxHeight,
      }}
      role="dialog"
    >
      <div className="port-picker-header">
        <span className="port-picker-side">{side === "a" ? "接続元" : "接続先"}</span>
        <span className="port-picker-device">{deviceId}</span>
        {modelName && <span className="port-picker-model">{modelName}</span>}
      </div>
      <div className="port-picker-tools">
        <input
          className="port-picker-search"
          // 開いたらすぐ入力できるようにする
          autoFocus
          placeholder={flexible ? "IF 名を入力または検索(例: eth0)" : "ポートを検索"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="port-picker-next"
          disabled={!nextFree}
          title={nextFree ? undefined : "定義済みの空きポートがありません。IF 名を入力してください"}
          onClick={() => nextFree && choose({ kind: "port", entry: nextFree })}
        >
          次の空きポート{nextFree ? `(${nextFree.name})` : ""}
        </button>
      </div>
      <div className="port-picker-list">
        {options[0]?.kind === "new" && (
          <button
            type="button"
            className={`port-picker-item new${activeOption === options[0] ? " active" : ""}`}
            onClick={() => choose(options[0])}
          >
            新しい IF「{options[0].name}」を使う
          </button>
        )}
        {exact && !available(exact) && (
          <p className="port-picker-error">「{exact.name}」は使用中です</p>
        )}
        {groups.map(({ key, label, entries: group }) => (
          <section key={key}>
            <h4 className="port-picker-group">{label}</h4>
            {group.map((entry) => {
              const option = options.find((o) => o.kind === "port" && o.entry === entry);
              const mismatch =
                side === "b" &&
                peer?.type &&
                entry.type &&
                !portTypesCompatible(peer.type, entry.type);
              return (
                <button
                  type="button"
                  key={entry.name}
                  className={`port-picker-item${option && option === activeOption ? " active" : ""}`}
                  disabled={!available(entry)}
                  onClick={() => option && choose(option)}
                  onMouseEnter={() => option && setActive(options.indexOf(option))}
                >
                  <span className="port-picker-name">{entry.name}</span>
                  {entry.speed && <span className="port-picker-speed">{entry.speed}</span>}
                  {entry.bridge?.vnet && <span className="port-picker-speed">VNet</span>}
                  {mismatch && (
                    <span
                      className="port-picker-warning"
                      title={`接続元のポート種別(${PORT_TYPE_LABELS[peer.type as PortType]})と合いません`}
                    >
                      ⚠
                    </span>
                  )}
                  {entry.use && (
                    <span className="port-picker-use">
                      {allowsManyLinks(entry.type) && entry.use.links.length > 0
                        ? `${entry.use.links.length} 本`
                        : entry.use.peer
                          ? `→ ${endpointToString(entry.use.peer)}`
                          : "接続中"}
                    </span>
                  )}
                  {entry.bridge && entry.bridge.links > 0 && (
                    <span className="port-picker-use">{entry.bridge.links} 本</span>
                  )}
                </button>
              );
            })}
          </section>
        ))}
        {filtered.length === 0 && options.length === 0 && (
          <p className="port-picker-empty">
            {flexible ? "IF 名を入力してください" : "一致するポートがありません"}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** ポート種別ごとのまとまり。ブリッジ(SPEC 4.6。SDN の VNet も)は最後に「ブリッジ」としてまとめる */
function groupByType(entries: PortEntry[]): { key: string; label: string; entries: PortEntry[] }[] {
  const order: (PortType | undefined)[] = [...PORT_TYPES, undefined];
  return [
    ...order.map((type) => ({
      key: type ?? "none",
      label: type ? PORT_TYPE_LABELS[type] : "種別なし",
      entries: entries.filter((e) => !e.bridge && e.type === type),
    })),
    {
      key: "bridge",
      label: "ブリッジ(何本でもつなげる)",
      entries: entries.filter((e) => e.bridge),
    },
  ].filter((g) => g.entries.length > 0);
}
