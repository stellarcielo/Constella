// グループの一覧(SPEC 7.5)。デバイスのインスペクタの「グループ」欄と、トポロジのインスペクタの一覧。
// 一覧の項目をクリックすると、そのグループを選ぶ(枠のラベルのクリックと同じ)。

import { editCommands } from "../../commands";
import {
  addGroupMembers,
  type Device,
  type Group,
  groupsOfDevice,
  groupTitle,
  removeGroupMembers,
} from "../../core";
import { topologyStore, useTopology } from "../../store";

const titleOf = (group: Group) => groupTitle(group) || "(ID なし)";

/** デバイスの入っているグループ(× で外す)、ほかのグループに入れる欄、新しいグループを作るボタン */
export function DeviceGroupList({ device }: { device: Device }) {
  const topology = useTopology((s) => s.topology);
  const store = topologyStore.getState();
  const joined = groupsOfDevice(topology, device.id);
  const others = topology.groups.filter((g) => !g.members.includes(device.id));

  return (
    <section className="inspector-section">
      <div className="inspector-section-head">
        <h3>グループ</h3>
        <button
          type="button"
          className="inspector-button"
          title="このデバイスでグループを作る(⌘G)"
          onClick={() => editCommands.group()}
        >
          ＋ 新しいグループ
        </button>
      </div>
      <ul className="if-list">
        {joined.map((group) => (
          <li key={group.uid} className="if-row">
            <div className="if-row-head">
              <button
                type="button"
                className="if-row-toggle"
                title="このグループを選択"
                onClick={() => store.selectGroup(group.uid)}
              >
                <span className="if-name">{titleOf(group)}</span>
              </button>
              <button
                type="button"
                className="if-row-remove"
                title="このグループから外す"
                aria-label={`${titleOf(group)} から外す`}
                onClick={() => store.edit((t) => removeGroupMembers(t, group.uid, [device.id]))}
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
      {joined.length === 0 && <p className="muted">どのグループにも入っていません</p>}
      {others.length > 0 && (
        <select
          className="field-input"
          aria-label="グループに入れる"
          value=""
          onChange={(e) => {
            const uid = e.target.value;
            e.currentTarget.blur();
            if (uid !== "") store.edit((t) => addGroupMembers(t, uid, [device.id]));
          }}
        >
          <option value="">＋ グループに入れる…</option>
          {others.map((group) => (
            <option key={group.uid} value={group.uid}>
              {titleOf(group)}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}

/** 図のすべてのグループ(枠を出していないグループや、メンバーが空のグループも選べるように) */
export function TopologyGroupList() {
  const groups = useTopology((s) => s.topology.groups);
  return (
    <section className="inspector-section">
      <div className="inspector-section-head">
        <h3>グループ</h3>
        <span className="muted">{groups.length} 個</span>
      </div>
      <ul className="if-list">
        {groups.map((group) => (
          <li key={group.uid} className="if-row">
            <div className="if-row-head">
              <button
                type="button"
                className="if-row-toggle"
                title="このグループを選択"
                onClick={() => topologyStore.getState().selectGroup(group.uid)}
              >
                <span className="if-name">{titleOf(group)}</span>
              </button>
              <span className="if-free">{group.members.length} 台</span>
            </div>
          </li>
        ))}
      </ul>
      {groups.length === 0 && (
        <p className="muted">グループはまだありません。機器を選んで ⌘G で作れます</p>
      )}
    </section>
  );
}
