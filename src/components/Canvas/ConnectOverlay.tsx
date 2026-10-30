// 接続モードの表示: 案内、ポート選択ポップアップ、A からカーソルまでの破線(SPEC 7.2)。
// ReactFlow の子として置く(フローの座標変換を使うため)。

import { Panel, useReactFlow, useViewport, ViewportPortal } from "@xyflow/react";
import { useEffect, useState } from "react";
import { endpointNodeId, endpointToString } from "../../core";
import { type ChosenPort, topologyStore, uiStore, useTopology, useUi } from "../../store";
import { PortPicker } from "../PortPicker/PortPicker";
import { iconCenter } from "./geometry";

const PICKER_GAP = 12;

export function ConnectOverlay() {
  const mode = useUi((s) => s.mode);
  const connect = useUi((s) => s.connect);
  const topology = useTopology((s) => s.topology);
  const { getInternalNode, flowToScreenPosition, screenToFlowPosition } = useReactFlow();
  // 画面のスクロールや拡大縮小に合わせてポップアップと破線を動かす
  useViewport();

  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const awaiting = connect.stage === "awaitB";
  useEffect(() => {
    if (!awaiting) return;
    const onMove = (e: PointerEvent) =>
      setCursor(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [awaiting, screenToFlowPosition]);

  if (mode !== "connect") return null;

  const onChoose = (port: ChosenPort) => {
    const link = uiStore.getState().choosePort(port);
    if (link) topologyStore.getState().addLink(link.a, link.b);
  };

  // 作りかけの接続の破線: A のアイコン(A がブリッジなら、その箱)から、
  // カーソル(B 待ち)または B のアイコン(B のポート選択中)まで
  let line: { from: { x: number; y: number }; to: { x: number; y: number } } | undefined;
  if (connect.stage === "awaitB" || connect.stage === "pickB") {
    const a = getInternalNode(endpointNodeId(topology, connect.a.endpoint));
    const b = connect.stage === "pickB" ? getInternalNode(connect.device) : undefined;
    const to = b ? iconCenter(b) : cursor;
    if (a && to) line = { from: iconCenter(a), to };
  }

  let picker: { device: string; anchor: { x: number; y: number } } | undefined;
  if (connect.stage === "pickA" || connect.stage === "pickB") {
    const node = getInternalNode(connect.device);
    if (node) {
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured.width ?? 0;
      const anchor = flowToScreenPosition({ x: x + width, y });
      picker = { device: connect.device, anchor: { x: anchor.x + PICKER_GAP, y: anchor.y } };
    }
  }

  return (
    <>
      <Panel position="top-center" className="connect-hint">
        {hint(connect)}
      </Panel>
      {line && (
        <ViewportPortal>
          <svg className="pending-link" width={1} height={1}>
            <line x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} />
          </svg>
        </ViewportPortal>
      )}
      {picker && (
        <PortPicker
          key={`${connect.stage}:${picker.device}`}
          deviceId={picker.device}
          side={connect.stage === "pickA" ? "a" : "b"}
          peer={connect.stage === "pickB" ? connect.a : undefined}
          anchor={picker.anchor}
          onChoose={onChoose}
        />
      )}
    </>
  );
}

function hint(connect: ReturnType<typeof uiStore.getState>["connect"]): string {
  switch (connect.stage) {
    case "idle":
      return "接続元のデバイスかブリッジをクリック(Esc で選択モードに戻る)";
    case "pickA":
      return "接続元のポートを選択(Esc で取りやめ)";
    case "awaitB":
      return `${endpointToString(connect.a.endpoint)} から: 接続先のデバイスかブリッジをクリック(Esc で取りやめ)`;
    case "pickB":
      return `${endpointToString(connect.a.endpoint)} から: 接続先のポートを選択(Esc で取りやめ)`;
  }
}
