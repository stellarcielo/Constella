// React Flow のキャンバス。表示はストアのトポロジから作り、
// ドラッグ中の位置だけは画面側で持って、ドロップしたときに 1 回ストアへ書き込む(SPEC 8.2)。

import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  type OnSelectionChangeParams,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Endpoint,
  findModel,
  type Issue,
  type IssueTarget,
  linkMedia,
  type ModelCatalog,
  type Position,
  resolveLabel,
  resolveRole,
  type Severity,
  type Topology,
} from "../../core";
import { type Selection, topologyStore, uiStore, useTopology, useUi } from "../../store";
import { MODEL_DRAG_TYPE } from "../dnd";
import { isTyping, releaseInputFocus } from "../shortcuts";
import { ConnectOverlay } from "./ConnectOverlay";
import { DEVICE_ICON_BOX, DEVICE_NODE_WIDTH, DeviceNode, type DeviceNodeType } from "./DeviceNode";
import { LinkEdge, type LinkEdgeType } from "./LinkEdge";
import { parallelSlots } from "./linkGeometry";
import "./Canvas.css";

const nodeTypes: NodeTypes = { device: DeviceNode };
const edgeTypes: EdgeTypes = { link: LinkEdge };
// 描画のたびに新しい配列を渡すと React Flow が更新を繰り返すので定数にする
const DELETE_KEYS = ["Backspace", "Delete"];
const MULTI_SELECT_KEYS = ["Shift", "Meta"];
const PAN_BUTTONS = [1, 2];

const onNodeDragStop = (_e: unknown, _node: Node, dragged: Node[]) =>
  topologyStore.getState().moveDevices(dragged.map((n) => [n.id, n.position]));
const onDelete = ({ nodes, edges }: OnSelectionChangeParams) =>
  topologyStore.getState().deleteElements({
    devices: nodes.map((n) => n.id),
    links: edges.map((e) => e.id),
  });
const onNodeClick: NodeMouseHandler = (_e, node) => uiStore.getState().clickDevice(node.id);

/** 矢印キーで選択中の機器を動かす量(⇧キーを押していれば 4 倍) */
const ARROW_STEP = 5;
const ARROWS: Record<string, Position> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
const onPaneClick = () => uiStore.getState().clickPane();

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
  const rejectedEdits = useTopology((s) => s.rejectedEdits);
  const autoPositions = useTopology((s) => s.autoPositions);
  const placing = useTopology((s) => s.placing);
  const mode = useUi((s) => s.mode);
  const { screenToFlowPosition, getNodes, fitView, setViewport, getZoom } = useReactFlow();

  // 表示位置の要求: ファイルを開いたとき・新規のとき(_viewport が無ければ全体が見えるように)と、
  // 問題パネルで項目を選んだとき(そのデバイスが見えるように。今より拡大はしない)。
  // 座標の無いデバイスを並べている間は、並べ終わるまで待つ
  const viewRequest = useUi((s) => s.viewRequest);
  const handledView = useRef(0);
  useEffect(() => {
    if (viewRequest.id === handledView.current || placing) return;
    handledView.current = viewRequest.id;
    if (viewRequest.viewport) {
      void setViewport(viewRequest.viewport);
    } else if (viewRequest.focus) {
      void fitView({
        nodes: viewRequest.focus.map((id) => ({ id })),
        padding: 0.6,
        maxZoom: Math.max(getZoom(), 1),
        duration: 300,
      });
    } else {
      void fitView({ padding: 0.2, maxZoom: 1.5 });
    }
  }, [viewRequest, placing, fitView, setViewport, getZoom]);

  // 矢印キーで選択中の機器を動かす。React Flow 標準の矢印キー操作は機器にフォーカスがあるときしか
  // 効かないので止め(disableKeyboardA11y)、delete キーや C と同じくフォーカスの位置に関係なく効かせる
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const dir = ARROWS[e.key];
      if (!dir || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.target instanceof Element && e.target.closest("[aria-modal]")) return;
      if (uiStore.getState().mode !== "select") return;
      const selected = new Set(topologyStore.getState().selection.devices);
      if (selected.size === 0) return;
      e.preventDefault();
      const step = ARROW_STEP * (e.shiftKey ? 4 : 1);
      topologyStore.getState().moveDevices(
        getNodes()
          .filter((n) => selected.has(n.id))
          .map((n) => [n.id, { x: n.position.x + dir.x * step, y: n.position.y + dir.y * step }]),
        // 同じ機器を続けて動かしたら、取り消しは 1 回で戻るようにまとめる
        { coalesce: `arrow:${[...selected].sort().join(",")}` },
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [getNodes]);

  const derived = useMemo(
    () => ({
      nodes: buildNodes(topology, autoPositions, catalog, issues),
      edges: buildEdges(topology, catalog, issues),
    }),
    [topology, autoPositions, catalog, issues],
  );

  // ストア側が変わったら作り直す。React Flow が測ったノードの大きさは引き継ぐ
  const [nodes, setNodes] = useState<DeviceNodeType[]>(derived.nodes);
  const [edges, setEdges] = useState<LinkEdgeType[]>(derived.edges);
  const [prevDerived, setPrevDerived] = useState(derived);
  // GUI の編集が取りやめになったとき(YAML の構文エラー中など)も、ストアの位置に戻す
  const [prevRejected, setPrevRejected] = useState(rejectedEdits);
  // キャンバスで選んだ選択(React Flow の印が先に付いている)は、キャンバスに書き戻さない。
  // 範囲選択の最中はノードとリンクの選択が別々に届くので、書き戻すと選択が行き来し続ける
  const [canvasSelection, setCanvasSelection] = useState<Selection>();
  const onSelectionChange = useCallback(({ nodes, edges }: OnSelectionChangeParams) => {
    const next = { devices: nodes.map((n) => n.id), links: edges.map((e) => e.id) };
    setCanvasSelection(next);
    topologyStore.getState().setSelection(next);
  }, []);
  const [prevSelection, setPrevSelection] = useState(selection);
  if (derived !== prevDerived || rejectedEdits !== prevRejected) {
    setPrevDerived(derived);
    setPrevRejected(rejectedEdits);
    setPrevSelection(selection);
    const measured = new Map(nodes.map((n) => [n.id, n.measured]));
    setNodes(
      withSelection(
        derived.nodes.map((n) => ({ ...n, measured: measured.get(n.id) })),
        selection.devices,
      ),
    );
    setEdges(withSelection(derived.edges, selection.links));
  } else if (selection !== prevSelection) {
    // 選択だけが変わったとき(インスペクタ・貼り付け・⌘A など)は、選択の印だけを合わせる
    setPrevSelection(selection);
    if (selection !== canvasSelection) {
      setNodes((ns) => withSelection(ns, selection.devices));
      setEdges((es) => withSelection(es, selection.links));
    }
  }

  const onNodesChange = useCallback((changes: NodeChange<DeviceNodeType>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    // ドラッグを終えたときは dragging: false の位置の変化が届く(onNodeDragStop と同じ内容。保存は 1 回だけになる)
    const moved: [string, Position][] = [];
    for (const change of changes) {
      if (change.type === "position" && change.dragging === false && change.position) {
        moved.push([change.id, change.position]);
      }
    }
    if (moved.length > 0) topologyStore.getState().moveDevices(moved);
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange<LinkEdgeType>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
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
      if (uiStore.getState().mode === "select") store.setSelection({ devices: [id], links: [] });
    },
    [screenToFlowPosition],
  );

  const selecting = mode === "select";
  return (
    <div
      className={`canvas mode-${mode}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      // キャンバスを触ったら、インスペクタなどの入力欄からフォーカスを外す(キー操作をキャンバスに効かせる)
      onPointerDownCapture={(e) => releaseInputFocus(e.currentTarget)}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onDelete={onDelete}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        deleteKeyCode={DELETE_KEYS}
        disableKeyboardA11y
        multiSelectionKeyCode={MULTI_SELECT_KEYS}
        // 接続モードでは、うっかり動かしたり選択したりしないように止める
        nodesDraggable={selecting}
        elementsSelectable={selecting}
        nodesConnectable={false}
        // 空いている所のドラッグは範囲選択。移動はトラックパッドのスクロールか中ボタン/右ボタンのドラッグ
        selectionOnDrag={selecting}
        panOnDrag={PAN_BUTTONS}
        panOnScroll
        colorMode="system"
        minZoom={0.2}
        maxZoom={4}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
        <ConnectOverlay />
      </ReactFlow>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * 座標の無いデバイスは、自動で並べた位置(autoPositions)に出す(SPEC 9章)。
 * その位置は layout には書かない(動かしたときに初めて書く)。並べ終わるまでは隠しておく
 */
function buildNodes(
  t: Topology,
  autoPositions: ReadonlyMap<string, Position>,
  catalog: ModelCatalog,
  issues: Issue[],
): DeviceNodeType[] {
  const problems = worstProblems(issues, (target) =>
    target.kind === "device" ? target.id : target.kind === "interface" ? target.device : undefined,
  );
  return [...t.devices.values()].map((device) => {
    const model = findModel(device, catalog);
    const position = t.layout.get(device.id) ?? autoPositions.get(device.uid);
    return {
      id: device.id,
      type: "device",
      position: position ?? { x: 0, y: 0 },
      hidden: !position,
      data: {
        label: resolveLabel(device),
        role: resolveRole(device, catalog),
        modelName: model?.name ?? device.model,
        problem: problems.get(device.id),
      },
    };
  });
}

function buildEdges(t: Topology, catalog: ModelCatalog, issues: Issue[]): LinkEdgeType[] {
  const problems = worstProblems(issues, (target) =>
    target.kind === "link" ? target.id : undefined,
  );
  // 端が不正なリンクや、存在しないデバイスへのリンクは描けない(問題パネルに出る)
  const drawable: { link: (typeof t.links)[number]; a: Endpoint; b: Endpoint }[] = [];
  for (const link of t.links) {
    if (link.a && link.b && t.devices.has(link.a.device) && t.devices.has(link.b.device)) {
      drawable.push({ link, a: link.a, b: link.b });
    }
  }
  const slots = parallelSlots(
    drawable.map(({ link, a, b }) => ({ id: link.id, source: a.device, target: b.device })),
  );
  return drawable.map(({ link, a, b }) => {
    const media = linkMedia(link, t, catalog);
    const problem = problems.get(link.id);
    const slot = slots.get(link.id) ?? { index: 0, count: 1 };
    return {
      id: link.id,
      type: "link",
      source: a.device,
      target: b.device,
      className: problem ? `media-${media} problem-${problem}` : `media-${media}`,
      data: {
        media,
        aName: a.iface,
        bName: b.iface,
        label: link.label,
        slotIndex: slot.index,
        slotCount: slot.count,
      },
    };
  });
}

/** 対象ごとに、いちばん重い問題を求める(赤 = エラー、黄 = 警告) */
function worstProblems(
  issues: Issue[],
  keyOf: (target: IssueTarget) => string | undefined,
): Map<string, Severity> {
  const result = new Map<string, Severity>();
  for (const issue of issues) {
    const key = keyOf(issue.target);
    if (key === undefined || result.get(key) === "error") continue;
    result.set(key, issue.severity);
  }
  return result;
}

/** 選択の印を ids に合わせる。変わらない要素や、何も変わらない配列はそのまま返す */
function withSelection<T extends { id: string; selected?: boolean }>(
  items: T[],
  ids: string[],
): T[] {
  const selected = new Set(ids);
  let changed = false;
  const next = items.map((item) => {
    const on = selected.has(item.id);
    if (!!item.selected === on) return item;
    changed = true;
    return { ...item, selected: on };
  });
  return changed ? next : items;
}
