// モデル一覧。検索欄と role ごとのグループ(ゲストのモデルは「ゲスト」にまとめる)。項目をキャンバスへドラッグして配置する。
// 「＋」でユーザーモデルを追加し、各項目の「複製」「編集」で既存のモデルを元に作る・直す(フェーズ3-4)。
// 「管理」でモデルの管理画面を開く(SPEC 5.5)。アイコンの画像が見つからないモデルがあれば知らせる。

import { useMemo, useState } from "react";
import { type DeviceModel, emptyModelForm, parseIconRef } from "../../core";
import { ModelIcon } from "../../icons/ModelIcon";
import { useIcons, useTopology, useUserModels } from "../../store";
import { askDialog } from "../Dialog/dialogs";
import { MODEL_DRAG_TYPE } from "../dnd";
import { modelSections } from "../modelSections";
import { openModelEditor } from "../ModelEditor/editorStore";
import { duplicateModel, editModel } from "../ModelManager/actions";
import { openModelManager } from "../ModelManager/managerStore";
import "./Palette.css";

export function Palette() {
  const catalog = useTopology((s) => s.catalog);
  const files = useUserModels((s) => s.files);
  const loadError = useUserModels((s) => s.loadError);
  const images = useIcons((s) => s.images);
  const [query, setQuery] = useState("");

  /** ユーザーモデルの ID → ファイル(「ユーザー」の印と編集のため) */
  const userFiles = useMemo(
    () => new Map(files.flatMap((f) => (f.model ? [[f.model.id, f] as const] : []))),
    [files],
  );
  const broken = files.filter((f) => !f.model);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (m: DeviceModel) =>
      q === "" || [m.id, m.name, m.vendor].some((v) => v?.toLowerCase().includes(q));
    return modelSections([...catalog.values()].filter(matches));
  }, [catalog, query]);

  /** アイコンの画像が見つからないモデル(SPEC 5.1) */
  const missingIcons = [...catalog.values()].flatMap((m) => {
    const ref = m.icon === undefined ? undefined : parseIconRef(m.icon);
    return ref?.kind === "image" && !images.has(ref.file) ? [`${m.id}: ${ref.file}`] : [];
  });
  const showMissingIcons = () =>
    void askDialog({
      title: "アイコンの画像が見つからないモデル",
      message:
        "次のモデルのアイコンの画像が、アイコンのフォルダ(macOS では ~/Library/Application Support/Constella/icons)にありません。役割のアイコンで表示しています。モデルの管理画面で、画像を取り込み直すか、アイコンを選び直してください。",
      details: missingIcons,
      actions: [{ value: "ok", label: "OK", primary: true }],
      cancelLabel: null,
    });

  /** 読めないモデルファイルの一覧(フェーズ3-4 Q7) */
  const showBroken = () =>
    void askDialog({
      title: "読めないモデルファイル",
      message:
        "次のユーザーモデルは、誤りがあるため使えません。ユーザーモデルのフォルダ(macOS では ~/Library/Application Support/Constella/models)のファイルを直してください。",
      details: [
        ...(loadError ? [`フォルダを読めませんでした: ${loadError}`] : []),
        ...broken.map(
          (f) =>
            `${f.file}: ${f.issues.find((i) => i.severity === "error")?.message ?? "読めません"}`,
        ),
      ],
      actions: [{ value: "ok", label: "OK", primary: true }],
      cancelLabel: null,
    });

  return (
    <aside className="palette">
      <div className="palette-head">
        <input
          className="palette-search"
          type="search"
          placeholder="モデルを検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="palette-add"
          title="モデルを追加"
          aria-label="モデルを追加"
          onClick={() => openModelEditor(emptyModelForm())}
        >
          ＋
        </button>
        <button
          type="button"
          className="palette-add palette-manage"
          title="モデルの管理(一覧・アイコンの設定・削除)"
          onClick={openModelManager}
        >
          管理
        </button>
      </div>
      <div className="palette-list">
        {groups.map(({ key, label, models }) => (
          <section key={key}>
            <h3 className="palette-group">{label}</h3>
            {models.map((m) => {
              const userFile = userFiles.get(m.id);
              return (
                <div
                  key={m.id}
                  className="palette-item"
                  draggable
                  title={m.id}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MODEL_DRAG_TYPE, m.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <span className={`role-icon role-${m.role}`}>
                    <ModelIcon role={m.role} icon={m.icon} size={22} />
                  </span>
                  <span className="palette-item-text">
                    <span className="palette-item-name">{m.name ?? m.id}</span>
                    <span className="palette-item-vendor">
                      {userFile && <span className="palette-badge">ユーザー</span>}
                      {m.vendor}
                    </span>
                  </span>
                  <span className="palette-actions">
                    <button
                      type="button"
                      title="このモデルを元に、新しいモデルを作る"
                      onClick={() => duplicateModel(m)}
                    >
                      複製
                    </button>
                    {userFile && (
                      <button
                        type="button"
                        title="このモデルを編集"
                        onClick={() => editModel(userFile)}
                      >
                        編集
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </section>
        ))}
        {groups.length === 0 && <p className="palette-empty">一致するモデルがありません</p>}
      </div>
      {(broken.length > 0 || loadError) && (
        <button type="button" className="palette-broken" onClick={showBroken}>
          {loadError ? "ユーザーモデルのフォルダを読めません" : ""}
          {broken.length > 0 ? `読めないモデルファイルが ${broken.length} 件` : ""}
        </button>
      )}
      {missingIcons.length > 0 && (
        <button type="button" className="palette-broken" onClick={showMissingIcons}>
          アイコンの画像が見つからないモデルが {missingIcons.length} 件
        </button>
      )}
    </aside>
  );
}
