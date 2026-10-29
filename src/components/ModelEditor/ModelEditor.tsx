// モデルの追加・編集ダイアログ(SPEC 5章・フェーズ3-4)。フォームで入力し、連番を展開したポートを
// その場で見せる。保存するとユーザーモデルのフォルダに `<id>.yaml` を書き出し、すぐパレットに出る。

import { useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import {
  checkModelForm,
  expandPortName,
  type ModelForm,
  normalizeIfName,
  PORT_TYPES,
  type PortRow,
  type PortType,
  ROLES,
  type Role,
} from "../../core";
import { ROLE_LABELS } from "../../icons/roles";
import { loadBuiltinModels } from "../../library";
import { userModelsStore, useTopology, useUserModels } from "../../store";
import { modelFileName } from "../../store/userModels";
import { askDialog } from "../Dialog/dialogs";
import { PORT_TYPE_LABELS } from "../portTypes";
import { closeModelEditor, type ModelEditorRequest, modelEditorStore } from "./editorStore";
import "../Dialog/ConfirmDialog.css";
import "./ModelEditor.css";

const BUILTIN = new Map(loadBuiltinModels().models.map((m) => [m.id, m]));

export function ModelEditorHost() {
  const request = useStore(modelEditorStore, (s) => s.request);
  return request ? <ModelEditor key={request.id} request={request} /> : null;
}

async function showError(title: string, message: string, details?: string[]): Promise<void> {
  await askDialog({
    title,
    message,
    details,
    actions: [{ value: "ok", label: "OK", primary: true }],
    cancelLabel: null,
  });
}

/** パターンを展開した結果の短い説明(「Gi0/1 〜 Gi0/24(24 個)」)。誤りがあれば undefined */
function rowSummary(row: PortRow): string | undefined {
  if (row.name.trim() === "") return undefined;
  const result = expandPortName(row.name.trim());
  if (!result.ok) return undefined;
  const names = result.names.map(normalizeIfName);
  return names.length === 1
    ? names[0]
    : `${names[0]} 〜 ${names[names.length - 1]}(${names.length} 個)`;
}

function ModelEditor({ request }: { request: ModelEditorRequest }) {
  const titleId = useId();
  const [form, setForm] = useState<ModelForm>(request.form);
  const [busy, setBusy] = useState(false);
  const topology = useTopology((s) => s.topology);
  const files = useUserModels((s) => s.files);
  const check = useMemo(() => checkModelForm(form), [form]);

  const editing = request.file !== undefined;
  /** 編集前の ID(図で使っている台数を数えるため) */
  const originalId = editing ? request.form.id.trim() : undefined;
  const id = form.id.trim();
  const builtin = BUILTIN.get(id);
  // ほかのユーザーモデルと同じ ID にすると、そのファイルを上書きしてしまう
  const clash = files.find((f) => f.file !== request.file && f.model?.id === id);
  const issues = clash
    ? [
        ...check.issues,
        { severity: "error" as const, message: `ID「${id}」のユーザーモデルはすでにあります` },
      ]
    : check.issues;
  const canSave = check.model !== undefined && !clash && !busy;
  const usage = (modelId: string) =>
    [...topology.devices.values()].filter((d) => d.model === modelId).length;

  const update = (changes: Partial<ModelForm>) => setForm((f) => ({ ...f, ...changes }));
  const updateRow = (index: number, changes: Partial<PortRow>) =>
    setForm((f) => ({
      ...f,
      ports: f.ports.map((row, i) => (i === index ? { ...row, ...changes } : row)),
    }));

  async function save() {
    if (!check.model || clash) return;
    // 図で使っているモデルを変えるときは確かめる(フェーズ3-4 Q5)
    const used = originalId ? usage(originalId) : 0;
    if (used > 0) {
      const choice = await askDialog({
        title: `「${originalId}」を変更しますか?`,
        message: `このモデルは、開いている図で ${used} 台が使っています。図はそのままで、合わなくなった接続(無くなったポートなど)は問題パネルにエラーとして出ます。`,
        actions: [{ value: "save", label: "変更する", primary: true }],
      });
      if (choice !== "save") return;
    }
    setBusy(true);
    try {
      await userModelsStore.getState().save(modelFileName(id), check.text, request.file);
      closeModelEditor();
    } catch (e) {
      await showError("保存できませんでした", `モデル「${id}」を保存できませんでした。`, [
        String(e),
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!request.file || !originalId) return;
    const used = usage(originalId);
    const choice = await askDialog({
      title: `「${originalId}」を削除しますか?`,
      message:
        used > 0
          ? `このモデルは、開いている図で ${used} 台が使っています。図はそのままで、モデルが見つからないエラーが問題パネルに出ます。`
          : "ユーザーモデルのフォルダから、このモデルのファイルを削除します。",
      actions: [{ value: "remove", label: "削除", primary: true, danger: true }],
    });
    if (choice !== "remove") return;
    setBusy(true);
    try {
      await userModelsStore.getState().remove(request.file);
      closeModelEditor();
    } catch (e) {
      await showError("削除できませんでした", `「${request.file}」を削除できませんでした。`, [
        String(e),
      ]);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="dialog-backdrop">
      <div
        className="dialog model-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            closeModelEditor();
          }
        }}
      >
        <h2 id={titleId} className="dialog-title">
          {editing ? "モデルを編集" : "モデルを追加"}
        </h2>
        <div className="model-editor-fields">
          <label className="model-editor-label" htmlFor={`${titleId}-id`}>
            ID
          </label>
          <div>
            <input
              id={`${titleId}-id`}
              className="field-input mono"
              value={form.id}
              autoFocus
              spellCheck={false}
              placeholder="例: cisco-c9200-24t"
              onChange={(e) => update({ id: e.target.value })}
            />
            {builtin && (
              <p className="model-editor-note">
                組み込みのモデル「{builtin.name ?? builtin.id}」を置き換えます(同じ ID
                はユーザーモデルが優先されます)
              </p>
            )}
          </div>
          <label className="model-editor-label" htmlFor={`${titleId}-vendor`}>
            メーカー
          </label>
          <input
            id={`${titleId}-vendor`}
            className="field-input"
            value={form.vendor}
            placeholder="例: Cisco"
            onChange={(e) => update({ vendor: e.target.value })}
          />
          <label className="model-editor-label" htmlFor={`${titleId}-name`}>
            名前
          </label>
          <input
            id={`${titleId}-name`}
            className="field-input"
            value={form.name}
            placeholder="例: Catalyst 9200-24T"
            onChange={(e) => update({ name: e.target.value })}
          />
          <label className="model-editor-label" htmlFor={`${titleId}-role`}>
            役割
          </label>
          <div className="model-editor-row">
            <select
              id={`${titleId}-role`}
              className="field-input"
              value={form.role}
              onChange={(e) => update({ role: e.target.value as Role })}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}({role})
                </option>
              ))}
            </select>
            <label className="model-editor-check">
              <input
                type="checkbox"
                checked={form.flexible}
                onChange={(e) => update({ flexible: e.target.checked })}
              />
              フレキシブル(定義していない IF 名も使える)
            </label>
          </div>
        </div>

        <h3 className="model-editor-heading">ポート</h3>
        <p className="model-editor-hint">
          {"{開始-終了}"} で連番になります(例: <code>GigabitEthernet0/{"{1-24}"}</code>)
        </p>
        <table className="model-editor-ports">
          <thead>
            <tr>
              <th>名前のパターン</th>
              <th>種類</th>
              <th>速度</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {form.ports.map((row, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="field-input mono"
                    aria-label={`${i + 1} 行目の名前のパターン`}
                    value={row.name}
                    spellCheck={false}
                    placeholder="例: GigabitEthernet0/{1-24}"
                    onChange={(e) => updateRow(i, { name: e.target.value })}
                  />
                  {rowSummary(row) && (
                    <span className="model-editor-summary mono">→ {rowSummary(row)}</span>
                  )}
                </td>
                <td>
                  <select
                    className="field-input"
                    aria-label={`${i + 1} 行目の種類`}
                    value={row.type}
                    onChange={(e) => updateRow(i, { type: e.target.value as PortType })}
                  >
                    {PORT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {PORT_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="field-input"
                    aria-label={`${i + 1} 行目の速度`}
                    value={row.speed}
                    placeholder="例: 1G"
                    onChange={(e) => updateRow(i, { speed: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="model-editor-remove"
                    title="この行を削除"
                    onClick={() =>
                      setForm((f) => ({ ...f, ports: f.ports.filter((_, j) => j !== i) }))
                    }
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="model-editor-row">
          <button
            type="button"
            className="dialog-button"
            onClick={() =>
              setForm((f) => ({
                ...f,
                ports: [
                  ...f.ports,
                  // 種類は直前の行と同じにしておく(同じ種類のポートが続くことが多い)
                  { name: "", type: f.ports[f.ports.length - 1]?.type ?? "rj45", speed: "" },
                ],
              }))
            }
          >
            ＋ ポートを追加
          </button>
          <span className="muted">合計 {check.ports.length} ポート</span>
        </div>

        {issues.length > 0 && (
          <ul className="model-editor-issues">
            {issues.map((issue, i) => (
              <li key={i} className={issue.severity}>
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        <div className="dialog-actions">
          {editing && (
            <button
              type="button"
              className="dialog-button danger-text"
              disabled={busy}
              onClick={() => void remove()}
            >
              削除
            </button>
          )}
          <span className="model-editor-spacer" />
          <button type="button" className="dialog-button" onClick={closeModelEditor}>
            キャンセル
          </button>
          <button
            type="button"
            className="dialog-button primary"
            disabled={!canSave}
            onClick={() => void save()}
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
