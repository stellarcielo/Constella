// モデル一覧。検索欄と role ごとのグループ。項目をキャンバスへドラッグして配置する。

import { useMemo, useState } from "react";
import type { DeviceModel } from "../../core";
import { RoleIcon } from "../../icons/RoleIcon";
import { ROLE_LABELS, ROLE_ORDER } from "../../icons/roles";
import { useTopology } from "../../store";
import { MODEL_DRAG_TYPE } from "../dnd";
import "./Palette.css";

export function Palette() {
  const catalog = useTopology((s) => s.catalog);
  const [query, setQuery] = useState("");

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

  return (
    <aside className="palette">
      <input
        className="palette-search"
        type="search"
        placeholder="モデルを検索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="palette-list">
        {groups.map(({ role, models }) => (
          <section key={role}>
            <h3 className="palette-group">{ROLE_LABELS[role]}</h3>
            {models.map((m) => (
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
                  {m.vendor && <span className="palette-item-vendor">{m.vendor}</span>}
                </span>
              </div>
            ))}
          </section>
        ))}
        {groups.length === 0 && <p className="palette-empty">一致するモデルがありません</p>}
      </div>
    </aside>
  );
}
