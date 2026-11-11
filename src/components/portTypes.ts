// ポート種別と media の表示名。ポート種別の表示名は、問題のメッセージでも使うので core に置く。

import type { Media } from "../core";

export { PORT_TYPE_LABELS } from "../core";

export const MEDIA_LABELS: Record<Media, string> = {
  copper: "銅線(copper)",
  fiber: "光ファイバー(fiber)",
  dac: "DAC(dac)",
  wireless: "無線(wireless)",
  virtual: "仮想(virtual)",
};
