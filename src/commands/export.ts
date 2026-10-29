// 図を SVG / PNG に書き出す(フェーズ2-4)。SVG は core の renderSvg で作り、PNG はそれを画像にする。

import { type GroupKind, renderSvg } from "../core";
import { basename, type ImageFormat, type Platform } from "../platform/types";
import type { TopologyStore } from "../store/topologyStore";
import { defaultFileName } from "./files";

/** PNG の倍率(Retina 相当。フェーズ2-4 Q3) */
export const PNG_SCALE = 2;

export interface ExportCommandDeps {
  platform: Pick<Platform, "chooseExportPath" | "writeTextFile" | "writeBinaryFile">;
  store: TopologyStore;
  /** ツールバーの表示設定(IF 名・IP・VLAN・グループ。書き出しにも反映する) */
  view(): {
    showIfLabels: boolean;
    longIfNames: boolean;
    showGroups: boolean;
    showIp: boolean;
    showVlan: boolean;
    groupKinds: GroupKind[];
  };
  /** SVG を PNG のバイト列にする(width × height を scale 倍した大きさ) */
  rasterize(
    svg: string,
    width: number,
    height: number,
    scale: number,
  ): Promise<Uint8Array<ArrayBuffer>>;
  showError(title: string, message: string, details?: string[]): Promise<void>;
}

export interface ExportCommands {
  /** 書き出せたら true(キャンセルや失敗なら false) */
  exportImage(format: ImageFormat): Promise<boolean>;
}

/** 書き出し画面の初期のファイル名。保存済みならそのファイル名の拡張子を替え、無ければタイトルから作る */
export function exportFileName(format: ImageFormat, title?: string, filePath?: string): string {
  const base = defaultFileName(title, filePath).replace(/(\.constella)?\.ya?ml$/i, "");
  return `${base}.${format}`;
}

export function createExportCommands(deps: ExportCommandDeps): ExportCommands {
  const { platform, store } = deps;

  return {
    async exportImage(format) {
      // 打ち込み中の YAML も反映してから描く
      store.getState().commitYamlDraft();
      const { topology, catalog, autoPositions, filePath } = store.getState();
      const path = await platform.chooseExportPath(
        exportFileName(format, topology.meta.title, filePath),
        format,
      );
      if (!path) return false;
      // 座標の無いデバイスは、キャンバスと同じく自動配置の位置に描く
      const fallbackPositions = new Map<string, { x: number; y: number }>();
      for (const device of topology.devices.values()) {
        const pos = autoPositions.get(device.uid);
        if (pos) fallbackPositions.set(device.id, pos);
      }
      const { svg, width, height } = renderSvg(topology, catalog, {
        ...deps.view(),
        fallbackPositions,
      });
      try {
        if (format === "svg") await platform.writeTextFile(path, svg);
        else
          await platform.writeBinaryFile(path, await deps.rasterize(svg, width, height, PNG_SCALE));
      } catch (e) {
        await deps.showError("書き出せませんでした", `${basename(path)} に書き出せませんでした。`, [
          String(e),
        ]);
        return false;
      }
      return true;
    },
  };
}
