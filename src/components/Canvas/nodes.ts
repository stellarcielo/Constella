// キャンバスに置くノードと線の種類。
import type { BridgeNodeType } from "./BridgeNode";
import type { DeviceNodeType } from "./DeviceNode";
import type { LinkEdgeType } from "./LinkEdge";
import type { UplinkEdgeType } from "./UplinkEdge";

/** デバイスと、ブリッジの箱(SPEC 4.6) */
export type CanvasNode = DeviceNodeType | BridgeNodeType;
/** YAML のリンクと、ブリッジとホストの間の線 */
export type CanvasEdge = LinkEdgeType | UplinkEdgeType;
