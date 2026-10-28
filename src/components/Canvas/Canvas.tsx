// React Flow のキャンバス。表示はストアのトポロジから作り、
// ドラッグ中の位置だけは画面側で持って、ドロップしたときに 1 回ストアへ書き込む(SPEC 8.2)。

import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type DragEvent, useCallback, useMemo, useState } from "react";
import {
  findModel,
  type Issue,
  type ModelCatalog,
  type Position,
  resolveLabel,
  resolveRole,
  type Severity,
  type Topology,
} from "../../core";
import { topologyStore, useTopology, type Selection } from "../../store";
import { MODEL_DRAG_TYPE } from "../dnd";
import { DEVICE_ICON_BOX, DEVICE_NODE_WIDTH, DeviceNode, type DeviceNodeType } from "./DeviceNode";
import "./Canvas.css";

const nodeTypes: NodeTypes = { device: DeviceNode };
// 描画のたびに新しい配列を渡すと React Flow が更新を繰り返すので定数にする
const NO_EDGES: Edge[] = [];
const DELETE_KEYS = ["Backspace", "Delete"];
const MULTI_SELECT_KEYS = ["Shift", "Meta"];
const PAN_BUTTONS = [1, 2];

const onNodeDragStop = (_e: unknown, _node: Node, dragged: Node[]) =>
  topologyStore.getState().moveDevices(dragged.map((n) => [n.id, n.position]));
const onSelectionChange = ({ nodes }: OnSelectionChangeParams) =>
  topologyStore.getState().setSelection({ devices: nodes.map((n) => n.id), links: [] });
const onDelete = ({ nodes }: { nodes: Node[] }) =>
  topologyStore.getState().deleteDevices(nodes.map((n) => n.id));

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const topology = useTopology((s) => s.topology);
  const catalog = useTopology((s) => s.catalog);
  const selection = useTopology((s) => s.selection);
  const issues = useTopology((s) => s.issues);
  const { screenToFlowPosition } = useReactFlow();

  const derived = useMemo(
    () => buildNodes(topology, catalog, selection, issues),
    [topology, catalog, selection, issues],
  );

  // ストア側が変わったら作り直す。React Flow が測ったノードの大きさは引き継ぐ
  const [nodes, setNodes] = useState<DeviceNodeType[]>(derived);
  const [prevDerived, setPrevDerived] = useState(derived);
  if (derived !== prevDerived) {
    setPrevDerived(derived);
    const measured = new Map(nodes.map((n) => [n.id, n.measured]));
    setNodes(derived.map((n) => ({ ...n, measured: measured.get(n.id) })));
  }

  const onNodesChange = useCallback((changes: NodeChange<DeviceNodeType>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer.types.includes(MODEL_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      const modelId = e.dataTransfer.getData(MODEL_DRAG_TYPE);
      if (!modelId) return;
      e.preventDefault();
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // カーソルの位置がアイコンの中心になるように置く
      const store = topologyStore.getState();
      const id = store.addDevice(modelId, {
        x: p.x - DEVICE_NODE_WIDTH / 2,
        y: p.y - DEVICE_ICON_BOX / 2,
      });
      store.setSelection({ devices: [id], links: [] });
    },
    [screenToFlowPosition],
  );

  return (
    <div className="canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={NO_EDGES}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onDelete={onDelete}
        deleteKeyCode={DELETE_KEYS}
        multiSelectionKeyCode={MULTI_SELECT_KEYS}
        // 空いている所のドラッグは範囲選択。移動はトラックパッドのスクロールか中ボタン/右ボタンのドラッグ
        selectionOnDrag
        panOnDrag={PAN_BUTTONS}
        panOnScroll
        colorMode="system"
        minZoom={0.2}
        maxZoom={4}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

// ---------------------------------------------------------------------------

const PLACEHOLDER_GAP_X = 140;
const PLACEHOLDER_GAP_Y = 120;
const PLACEHOLDER_COLUMNS = 6;

/**
 * 座標の無いデバイスは、座標のあるデバイスの下に格子状に並べる。
 * この仮の位置は layout には書かない(動かしたときに初めて書く)。
 */
function placeholderPositions(t: Topology): Map<string, Position> {
  const result = new Map<string, Position>();
  const missing = [...t.devices.keys()].filter((id) => !t.layout.has(id));
  if (missing.length === 0) return result;
  const placed = [...t.layout.values()];
  const left = placed.length > 0 ? Math.min(...placed.map((p) => p.x)) : 0;
  const top = placed.length > 0 ? Math.max(...placed.map((p) => p.y)) + PLACEHOLDER_GAP_Y * 1.5 : 0;
  missing.forEach((id, i) => {
    result.set(id, {
      x: left + (i % PLACEHOLDER_COLUMNS) * PLACEHOLDER_GAP_X,
      y: top + Math.floor(i / PLACEHOLDER_COLUMNS) * PLACEHOLDER_GAP_Y,
    });
  });
  return result;
}

function buildNodes(
  t: Topology,
  catalog: ModelCatalog,
  selection: Selection,
  issues: Issue[],
): DeviceNodeType[] {
  const placeholders = placeholderPositions(t);
  const selected = new Set(selection.devices);
  const problems = deviceProblems(issues);
  return [...t.devices.values()].map((device) => {
    const model = findModel(device, catalog);
    return {
      id: device.id,
      type: "device",
      position: t.layout.get(device.id) ?? placeholders.get(device.id) ?? { x: 0, y: 0 },
      selected: selected.has(device.id),
      data: {
        label: resolveLabel(device),
        role: resolveRole(device, catalog),
        modelName: model?.name ?? device.model,
        problem: problems.get(device.id),
      },
    };
  });
}

/** デバイスごとに、いちばん重い問題を求める(赤 = エラー、黄 = 警告) */
function deviceProblems(issues: Issue[]): Map<string, Severity> {
  const result = new Map<string, Severity>();
  for (const issue of issues) {
    const t = issue.target;
    const id = t.kind === "device" ? t.id : t.kind === "interface" ? t.device : undefined;
    if (id === undefined || result.get(id) === "error") continue;
    result.set(id, issue.severity);
  }
  return result;
}
