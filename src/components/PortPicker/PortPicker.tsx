// ポート選択ポップアップ(SPEC 7.2)。
// 種別ごとのグループ、使用中ポートのグレーアウトと接続先、検索欄、次の空きポート、
// フレキシブルデバイスでの IF 名の自由入力、A 側と種別が合わないポートの警告。

import { type KeyboardEvent, useMemo, useState } from "react";
import {
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
import "./PortPicker.css";

const TYPE_LABELS: Record<PortType, string> = {
  rj45: "RJ45",
  sfp: "SFP",
  "sfp+": "SFP+",
  sfp28: "SFP28",
  "qsfp+": "QSFP+",
  qsfp28: "QSFP28",
  console: "コンソール",
  serial: "シリアル",
  wireless: "無線",
  virtual: "仮想",
};

const WIDTH = 280;
const MAX_HEIGHT = 420;
const MARGIN = 8;

export interface PortPickerProps {
  deviceId: string;
  side: "a" | "b";
  /** B 側を選ぶときの、A 側で選んだポート */
  peer?: ChosenPort;
  /** 表示位置(ウィンドウ座標) */
  anchor: { x: number; y: number };
  onChoose(port: ChosenPort): void;
}

/** 選べる項目。既存のポートか、フレキシブルデバイスで新しく入力した IF 名 */
type Option = { kind: "port"; entry: PortEntry } | { kind: "new"; name: string };

export function PortPicker({ deviceId, side, peer, anchor, onChoose }: PortPickerProps) {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const device = topology.devices.get(deviceId);
  const flexible = device ? isFlexibleDevice(device, catalog) : false;
  const entries = useMemo(
    () => (device ? listDevicePorts(device, topology, catalog, undefined, peer?.endpoint) : []),
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
    ...filtered.filter((e) => !e.use).map((entry) => ({ kind: "port", entry }) as const),
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
  const left = Math.max(MARGIN, Math.min(anchor.x, window.innerWidth - WIDTH - MARGIN));
  const top = Math.max(MARGIN, Math.min(anchor.y, window.innerHeight - MAX_HEIGHT - MARGIN));
  const modelName = device.model ? (catalog.get(device.model)?.name ?? device.model) : undefined;

  return (
    <div
      className="port-picker"
      style={{ left, top, width: WIDTH, maxHeight: MAX_HEIGHT }}
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
        {exact?.use && <p className="port-picker-error">「{exact.name}」は使用中です</p>}
        {groups.map(({ type, entries: group }) => (
          <section key={type ?? "none"}>
            <h4 className="port-picker-group">{type ? TYPE_LABELS[type] : "種別なし"}</h4>
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
                  disabled={!!entry.use}
                  onClick={() => option && choose(option)}
                  onMouseEnter={() => option && setActive(options.indexOf(option))}
                >
                  <span className="port-picker-name">{entry.name}</span>
                  {entry.speed && <span className="port-picker-speed">{entry.speed}</span>}
                  {mismatch && (
                    <span
                      className="port-picker-warning"
                      title={`接続元のポート種別(${TYPE_LABELS[peer.type as PortType]})と合いません`}
                    >
                      ⚠
                    </span>
                  )}
                  {entry.use && (
                    <span className="port-picker-use">
                      {entry.use.peer ? `→ ${endpointToString(entry.use.peer)}` : "接続中"}
                    </span>
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
    </div>
  );
}

function groupByType(entries: PortEntry[]): { type?: PortType; entries: PortEntry[] }[] {
  const order: (PortType | undefined)[] = [...PORT_TYPES, undefined];
  return order
    .map((type) => ({ type, entries: entries.filter((e) => e.type === type) }))
    .filter((g) => g.entries.length > 0);
}
