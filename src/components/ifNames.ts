// IF 名の表示。ツールバーの「長い名前」の設定に合わせる。

import { useCallback } from "react";
import { expandIfName } from "../core";
import { useUi } from "../store";

export function useIfNameFormatter(): (name: string) => string {
  const long = useUi((s) => s.view.longIfNames);
  return useCallback((name: string) => (long ? expandIfName(name) : name), [long]);
}
