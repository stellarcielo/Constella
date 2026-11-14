// モデルの管理画面(SPEC 5.5)。左にモデルの一覧(読めないユーザーモデルのファイルも)、右に選んだモデルの
// 中身と操作(追加・複製・編集・削除・アイコンの設定)。追加・編集は、今のダイアログ(ModelEditor)を開く。
// 下のボタンで、ユーザーモデルとアイコンを 1 つのファイルに書き出す・そこから読み込む(書き出すモデルは、
// 画面を切り替えてチェックで選ぶ)。

import { useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import type { DeviceModel, PortDef, PortType } from "../../core";
import { emptyModelForm } from "../../core";
import { ModelIcon } from "../../icons/ModelIcon";
import { GUEST_LABELS, ROLE_LABELS } from "../../icons/roles";
import { useIcons, useTopology, useUserModels } from "../../store";
import type { UserModelFile } from "../../store/userModels";
import { openModelEditor } from "../ModelEditor/editorStore";
import { modelSections } from "../modelSections";
import { PORT_TYPE_LABELS } from "../portTypes";
import {
  duplicateModel,
  editModel,
  exportModelBundle,
  iconDescription,
  importModelBundle,
  modelUsage,
  removeModelFile,
  setUserModelIcon,
} from "./actions";
import { IconPicker } from "./IconPicker";
import { closeModelManager, modelManagerStore } from "./managerStore";
import "../Dialog/ConfirmDialog.css";
import "./ModelManager.css";

export function ModelManagerHost() {
  const open = useStore(modelManagerStore, (s) => s.open);
  return open ? <ModelManager /> : null;
}

/** 一覧で選んでいるもの: モデル(ID)か、読めないファイル */
type Selected = { kind: "model"; id: string } | { kind: "broken"; file: string };

/** ポートを種類ごとにまとめる(出てきた順)。「RJ45 × 24(Gi0/1 〜 Gi0/24)」の形にする */
function portGroups(ports: readonly PortDef[]): { type: PortType; count: number; range: string }[] {
  const groups = new Map<PortType, PortDef[]>();
  for (const port of ports) {
    const list = groups.get(port.type);
    if (list) list.push(port);
    else groups.set(port.type, [port]);
  }
  return [...groups].map(([type, list]) => ({
    type,
    count: list.length,
    range: list.length === 1 ? list[0].name : `${list[0].name} 〜 ${list[list.length - 1].name}`,
  }));
}

function ModelManager() {
  const titleId = useId();
  const catalog = useTopology((s) => s.catalog);
  // 図で使っている台数を数え直すため
  useTopology((s) => s.topology);
  const files = useUserModels((s) => s.files);
  const loadError = useUserModels((s) => s.loadError);
  const images = useIcons((s) => s.images);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected>();
  /** 書き出すモデルを選んでいる間の、選んだファイル名 */
  const [exporting, setExporting] = useState<ReadonlySet<string> | null>(null);

  /** ユーザーモデルの ID → ファイル */
  const userFiles = useMemo(
    () => new Map(files.flatMap((f) => (f.model ? [[f.model.id, f] as const] : []))),
    [files],
  );
  const broken = files.filter((f) => !f.model);
  const readable = files.filter((f) => f.model);
  const toExport = readable.filter((f) => exporting?.has(f.file));
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (m: DeviceModel) =>
      q === "" || [m.id, m.name, m.vendor].some((v) => v?.toLowerCase().includes(q));
    return modelSections([...catalog.values()].filter(matches));
  }, [catalog, query]);

  const model = selected?.kind === "model" ? catalog.get(selected.id) : undefined;
  const brokenFile =
    selected?.kind === "broken" ? broken.find((f) => f.file === selected.file) : undefined;

  return createPortal(
    <div className="dialog-backdrop">
      <div
        className="dialog model-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            // 書き出すモデルを選んでいる間は、選ぶのをやめるだけ
            if (exporting) setExporting(null);
            else closeModelManager();
          }
        }}
      >
        <h2 id={titleId} className="dialog-title">
          {exporting ? "モデルを書き出す" : "モデルの管理"}
        </h2>
        {exporting ? (
          <ExportPicker files={readable} selected={exporting} onChange={setExporting} />
        ) : (
          <div className="model-manager-body">
            <div className="model-manager-side">
              <input
                className="field-input"
                type="search"
                placeholder="モデルを検索"
                aria-label="モデルを検索"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="model-manager-list">
                {groups.map(({ key, label, models }) => (
                  <section key={key}>
                    <h3 className="model-manager-group">{label}</h3>
                    {models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`model-manager-item${model?.id === m.id ? " selected" : ""}`}
                        onClick={() => setSelected({ kind: "model", id: m.id })}
                      >
                        <span className={`role-icon role-${m.role}`}>
                          <ModelIcon role={m.role} icon={m.icon} size={22} />
                        </span>
                        <span className="model-manager-item-text">
                          <span>{m.name ?? m.id}</span>
                          <span className="model-manager-item-sub">
                            {userFiles.has(m.id) && <span className="palette-badge">ユーザー</span>}
                            {m.vendor}
                          </span>
                        </span>
                      </button>
                    ))}
                  </section>
                ))}
                {groups.length === 0 && <p className="muted">一致するモデルがありません</p>}
                {(broken.length > 0 || loadError) && (
                  <section>
                    <h3 className="model-manager-group">読めないファイル</h3>
                    {loadError && (
                      <p className="model-manager-error">フォルダを読めませんでした: {loadError}</p>
                    )}
                    {broken.map((f) => (
                      <button
                        key={f.file}
                        type="button"
                        className={`model-manager-item${brokenFile?.file === f.file ? " selected" : ""}`}
                        onClick={() => setSelected({ kind: "broken", file: f.file })}
                      >
                        <span className="model-manager-item-text mono">{f.file}</span>
                      </button>
                    ))}
                  </section>
                )}
              </div>
            </div>
            <div className="model-manager-detail">
              {model ? (
                <ModelDetail model={model} file={userFiles.get(model.id)} images={images} />
              ) : brokenFile ? (
                <BrokenDetail file={brokenFile} onRemoved={() => setSelected(undefined)} />
              ) : (
                <p className="muted">左の一覧からモデルを選んでください</p>
              )}
            </div>
          </div>
        )}
        {exporting ? (
          <div className="dialog-actions">
            <span className="model-manager-spacer" />
            <button type="button" className="dialog-button" onClick={() => setExporting(null)}>
              キャンセル
            </button>
            <button
              type="button"
              className="dialog-button primary"
              disabled={toExport.length === 0}
              onClick={() =>
                void exportModelBundle(toExport).then((done) => {
                  if (done) setExporting(null);
                })
              }
            >
              書き出す…
            </button>
          </div>
        ) : (
          <div className="dialog-actions">
            <button
              type="button"
              className="dialog-button"
              onClick={() => openModelEditor(emptyModelForm())}
            >
              ＋ モデルを追加
            </button>
            <button
              type="button"
              className="dialog-button"
              title="ユーザーモデルと、それが使うアイコンの画像を 1 つのファイルに書き出す"
              disabled={readable.length === 0}
              onClick={() => setExporting(new Set(readable.map((f) => f.file)))}
            >
              書き出す…
            </button>
            <button
              type="button"
              className="dialog-button"
              title="書き出したファイルから、モデルとアイコンの画像を取り込む"
              onClick={() => void importModelBundle()}
            >
              読み込む…
            </button>
            <span className="model-manager-spacer" />
            <button type="button" className="dialog-button primary" onClick={closeModelManager}>
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** 書き出すユーザーモデルを選ぶ(チェックを付けたものを書き出す) */
function ExportPicker({
  files,
  selected,
  onChange,
}: {
  files: readonly UserModelFile[];
  selected: ReadonlySet<string>;
  onChange(selected: ReadonlySet<string>): void;
}) {
  const all = files.every((f) => selected.has(f.file));
  const toggle = (file: string) => {
    const next = new Set(selected);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    onChange(next);
  };
  return (
    <div className="model-export">
      <p className="model-detail-note">
        書き出すユーザーモデルを選んでください。選んだモデルが使うアイコンの画像も、一緒に入れます。
      </p>
      <label className="model-export-item all">
        <input
          type="checkbox"
          checked={all}
          onChange={() => onChange(new Set(all ? [] : files.map((f) => f.file)))}
        />
        すべて({selected.size} / {files.length} 個)
      </label>
      <div className="model-export-list">
        {files.map((f) => (
          <label key={f.file} className="model-export-item">
            <input type="checkbox" checked={selected.has(f.file)} onChange={() => toggle(f.file)} />
            {f.model && (
              <span className={`role-icon role-${f.model.role}`}>
                <ModelIcon role={f.model.role} icon={f.model.icon} size={20} />
              </span>
            )}
            <span>{f.model?.name ?? f.model?.id}</span>
            <span className="mono muted">{f.model?.id}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** 選んだモデルの中身と操作 */
function ModelDetail({
  model,
  file,
  images,
}: {
  model: DeviceModel;
  /** ユーザーモデルならそのファイル(組み込みは undefined) */
  file?: UserModelFile;
  images: ReadonlyMap<string, string>;
}) {
  const used = modelUsage(model.id);
  return (
    <div className="model-detail">
      <div className="model-detail-head">
        <span className={`role-icon role-${model.role}`}>
          <ModelIcon role={model.role} icon={model.icon} size={40} />
        </span>
        <div>
          <div className="model-detail-title">{model.name ?? model.id}</div>
          <div className="mono muted">{model.id}</div>
        </div>
      </div>
      <dl className="model-detail-fields">
        <dt>種類</dt>
        <dd>{file ? `ユーザーモデル(${file.file})` : "組み込みのモデル"}</dd>
        <dt>メーカー</dt>
        <dd>{model.vendor ?? "—"}</dd>
        <dt>役割</dt>
        <dd>
          {ROLE_LABELS[model.role]}({model.role})
        </dd>
        <dt>ゲスト</dt>
        <dd>{model.guest ? `${GUEST_LABELS[model.guest]}(${model.guest})` : "なし"}</dd>
        <dt>この図</dt>
        <dd>{used > 0 ? `${used} 台が使っています` : "使っていません"}</dd>
      </dl>

      <h3 className="model-detail-heading">アイコン</h3>
      {file ? (
        <IconPicker
          value={model.icon ?? ""}
          role={model.role}
          onChange={(icon) => void setUserModelIcon(file, icon)}
        />
      ) : (
        <p className="model-detail-note">
          {iconDescription(model.icon ?? "", model.role, images)}
          。組み込みのモデルは変えられないので、複製してから変えてください。
        </p>
      )}

      <h3 className="model-detail-heading">ポート({model.ports.length} 個)</h3>
      {model.ports.length > 0 ? (
        <ul className="model-detail-ports">
          {portGroups(model.ports).map(({ type, count, range }) => (
            <li key={type}>
              <span>
                {PORT_TYPE_LABELS[type]} × {count}
              </span>
              <span className="mono muted">{range}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="model-detail-note">定義したポートはありません</p>
      )}
      {model.flexible && (
        <p className="model-detail-note">フレキシブル: 定義していない IF 名も使えます</p>
      )}

      <div className="model-detail-actions">
        <button type="button" className="dialog-button" onClick={() => duplicateModel(model)}>
          複製
        </button>
        {file && (
          <>
            <button type="button" className="dialog-button" onClick={() => editModel(file)}>
              編集
            </button>
            <button
              type="button"
              className="dialog-button danger-text"
              onClick={() => void removeModelFile(file.file, model.id)}
            >
              削除
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** 読めないユーザーモデルのファイル。誤りを出し、削除できる */
function BrokenDetail({ file, onRemoved }: { file: UserModelFile; onRemoved(): void }) {
  return (
    <div className="model-detail">
      <div className="model-detail-title mono">{file.file}</div>
      <p className="model-detail-note">
        誤りがあるため使えません。ユーザーモデルのフォルダ(macOS では ~/Library/Application
        Support/Constella/models)のファイルを直すか、削除してください。
      </p>
      <ul className="model-manager-issues">
        {file.issues.map((issue, i) => (
          <li key={i} className={issue.severity}>
            {issue.message}
          </li>
        ))}
      </ul>
      <div className="model-detail-actions">
        <button
          type="button"
          className="dialog-button danger-text"
          onClick={() =>
            void removeModelFile(file.file).then((removed) => {
              if (removed) onRemoved();
            })
          }
        >
          削除
        </button>
      </div>
    </div>
  );
}
