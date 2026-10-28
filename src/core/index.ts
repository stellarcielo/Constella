// React・Tauri に依存しない純粋なロジック(パース・出力・検証・レイアウト)を置く。
// 将来の CLI / MCP サーバーからも再利用する。

export * from "./types";
export * from "./ifname";
export * from "./topology";
export { parseTopology, type ParseOptions, type ParseResult, type YamlBase } from "./parse";
export { serializeTopology, type SerializeResult } from "./serialize";
export { locateTarget, validateTopology } from "./validate";
export { expandPortName, type ExpandResult } from "./portExpand";
export { buildCatalog, type ModelParseResult, parseModelDefinition } from "./modelLibrary";
export * from "./edit";
export * from "./ports";
export * from "./media";
