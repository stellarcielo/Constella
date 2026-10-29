// モデル一覧。検索欄と role ごとのグループ。項目をキャンバスへドラッグして配置する。
// 「＋」でユーザーモデルを追加し、各項目の「複製」「編集」で既存のモデルを元に作る・直す(フェーズ3-4)。

import { useMemo, useState } from "react";
import { copyModelId, type DeviceModel, emptyModelForm, modelFormFromText } from "../../core";
import { RoleIcon } from "../../icons/RoleIcon";
import { ROLE_LABELS, ROLE_ORDER } from "../../icons/roles";
import { builtinModelText } from "../../library";
import { useTopology, useUserModels } from "../../store";
import type { UserModelFile } from "../../store/userModels";
import { askDialog } from "../Dialog/dialogs";
import { MODEL_DRAG_TYPE } from "../dnd";
import { openModelEditor } from "../ModelEditor/editorStore";
import "./Palette.css";

export function Palette() {
  const catalog = useTopology((s) => s.catalog);
  const files = useUserModels((s) => s.files);
  const loadError = useUserModels((s) => s.loadError);
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
    return ROLE_ORDER.map((role) => ({
      role,
      models: [...catalog.values()]
        .filter((m) => m.role === role && matches(m))
        .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)),
    })).filter((g) => g.models.length > 0);
  }, [catalog, query]);

  /** 既存のモデル(組み込み・ユーザー)を元に、新しいモデルを作る(フェーズ3-4 Q3) */
  const duplicate = (model: DeviceModel) => {
    const text = userFiles.get(model.id)?.text ?? builtinModelText(model.id);
    const form = text === undefined ? undefined : modelFormFromText(text);
    if (!form) return;
    const used = (id: string) => catalog.has(id) || files.some((f) => f.model?.id === id);
    openModelEditor({ ...form, id: copyModelId(model.id, used) });
  };

  const edit = (file: UserModelFile) => {
    const form = modelFormFromText(file.text);
    if (form) openModelEditor(form, file.file);
  };

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
      </div>
      <div className="palette-list">
        {groups.map(({ role, models }) => (
          <section key={role}>
            <h3 className="palette-group">{ROLE_LABELS[role]}</h3>
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
                    <RoleIcon role={m.role} size={22} />
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
                      onClick={() => duplicate(m)}
                    >
                      複製
                    </button>
                    {userFile && (
                      <button type="button" title="このモデルを編集" onClick={() => edit(userFile)}>
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
    </aside>
  );
}
