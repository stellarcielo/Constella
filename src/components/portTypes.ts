// ポート種別と media の表示名。

import type { Media, PortType } from "../core";

export const PORT_TYPE_LABELS: Record<PortType, string> = {
  rj45: "RJ45",
  sfp: "SFP",
  "sfp+": "SFP+",
  sfp28: "SFP28",
  "qsfp+": "QSFP+",
  qsfp28: "QSFP28",
  console: "コンソール",
  serial: "シリアル",
  wireless: "無線",
  virtual: "仮想",
};

export const MEDIA_LABELS: Record<Media, string> = {
  copper: "銅線(copper)",
  fiber: "光ファイバー(fiber)",
  dac: "DAC(dac)",
  wireless: "無線(wireless)",
  virtual: "仮想(virtual)",
};
