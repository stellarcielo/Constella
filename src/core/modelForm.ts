// モデルの追加・編集フォームの内容と、モデル定義 YAML(SPEC 5.1)の変換(フェーズ3-4)。
// ポートは連番のパターン(`GigabitEthernet0/{1-24}`)のまま扱い、保存すると YAML ファイルになる。

import { isMap, isScalar, isSeq, parseDocument, stringify } from "yaml";
import { parseModelDefinition } from "./modelLibrary";
import { DEVICE_ID_PATTERN } from "./topology";
import {
  type DeviceModel,
  GUEST_KINDS,
  type GuestKind,
  type ModelIssue,
  PORT_TYPES,
  type PortDef,
  type PortType,
  ROLES,
  type Role,
} from "./types";

export interface PortRow {
  /** ポート名のパターン(`{開始-終了}` で連番) */
  name: string;
  type: PortType;
  speed: string;
}

export interface ModelForm {
  id: string;
  vendor: string;
  name: string;
  role: Role;
  /** 定義していない IF 名も使えるか */
  flexible: boolean;
  /** このモデルの機器をゲスト(VM・コンテナ)にするか。空ならゲストではない */
  guest: GuestKind | "";
  ports: PortRow[];
  /** フォームでは扱わない項目(icon や未知のキー)。保存しても残す */
  extra: Record<string, unknown>;
}

/** モデルの ID は、そのままファイル名(`<id>.yaml`)にするので、デバイスID と同じ規則にする */
export const MODEL_ID_PATTERN = DEVICE_ID_PATTERN;

const FORM_KEYS = ["id", "vendor", "name", "role", "flexible", "guest", "ports"];

export function emptyModelForm(): ModelForm {
  return {
    id: "",
    vendor: "",
    name: "",
    role: "generic",
    flexible: false,
    guest: "",
    ports: [{ name: "", type: "rj45", speed: "" }],
    extra: {},
  };
}

/** モデル定義の YAML をフォームの内容にする(ポートはパターンのまま)。読めなければ undefined */
export function modelFormFromText(text: string): ModelForm | undefined {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return undefined;
  const root = doc.contents;
  const text_ = (key: string) => {
    const node = root.get(key, true);
    return isScalar(node) && node.value !== null ? String(node.value) : "";
  };
  const roleValue = text_("role");
  const guestValue = text_("guest");
  const ports: PortRow[] = [];
  const portsNode = root.get("ports", true);
  if (isSeq(portsNode)) {
    for (const item of portsNode.items) {
      if (!isMap(item)) continue;
      const value = (key: string) => {
        const node = item.get(key, true);
        return isScalar(node) && node.value !== null ? String(node.value) : "";
      };
      const type = value("type");
      ports.push({
        name: value("name"),
        type: (PORT_TYPES as readonly string[]).includes(type) ? (type as PortType) : "rj45",
        speed: value("speed"),
      });
    }
  }
  const extra: Record<string, unknown> = {};
  for (const pair of root.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : "";
    if (key !== "" && !FORM_KEYS.includes(key)) {
      extra[key] = (pair.value as { toJSON(): unknown } | null)?.toJSON() ?? null;
    }
  }
  const flexibleNode = root.get("flexible", true);
  return {
    id: text_("id"),
    vendor: text_("vendor"),
    name: text_("name"),
    role: (ROLES as readonly string[]).includes(roleValue) ? (roleValue as Role) : "generic",
    flexible: isScalar(flexibleNode) && (flexibleNode.value as unknown) === true,
    guest: (GUEST_KINDS as readonly string[]).includes(guestValue) ? (guestValue as GuestKind) : "",
    ports,
    extra,
  };
}

/** YAML の 1 つの値(必要なときだけ引用符を付ける) */
function scalar(value: string): string {
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

/**
 * フォームの内容をモデル定義の YAML にする(SPEC 5.1 の形)。
 * 空の項目は書かない。ポート名は `{` を含むことが多いので、いつも引用符で囲む
 */
export function modelFormToText(form: ModelForm): string {
  const lines = [`id: ${scalar(form.id.trim())}`];
  if (form.vendor.trim()) lines.push(`vendor: ${scalar(form.vendor.trim())}`);
  if (form.name.trim()) lines.push(`name: ${scalar(form.name.trim())}`);
  lines.push(`role: ${form.role}`);
  if (form.flexible) lines.push("flexible: true");
  if (form.guest) lines.push(`guest: ${form.guest}`);
  const ports = form.ports.filter((p) => p.name.trim() !== "");
  if (ports.length > 0) {
    lines.push("ports:");
    for (const port of ports) {
      lines.push(`  - name: ${JSON.stringify(port.name.trim())}`);
      lines.push(`    type: ${port.type}`);
      if (port.speed.trim()) lines.push(`    speed: ${scalar(port.speed.trim())}`);
    }
  }
  const extra = Object.keys(form.extra).length > 0 ? stringify(form.extra, { lineWidth: 0 }) : "";
  return `${lines.join("\n")}\n${extra}`;
}

export interface ModelFormCheck {
  /** 保存する YAML */
  text: string;
  /** 入力の誤り(エラーがあれば保存できない)と注意 */
  issues: ModelIssue[];
  /** 読めたモデル(エラーが無いとき) */
  model?: DeviceModel;
  /** 連番を展開したポート(プレビュー用。エラーのある行は含まない) */
  ports: PortDef[];
}

/** フォームの内容を確かめる。ポートの誤り(種類・連番・重複)はモデル定義の読み込みと同じ規則 */
export function checkModelForm(form: ModelForm): ModelFormCheck {
  const text = modelFormToText(form);
  const issues: ModelIssue[] = [];
  const id = form.id.trim();
  if (id === "") issues.push({ severity: "error", message: "ID を入力してください" });
  else if (!MODEL_ID_PATTERN.test(id)) {
    issues.push({
      severity: "error",
      message: `ID「${id}」は使えません(英数字で始まり、英数字と . _ - だけを使えます)`,
    });
  }
  if (!form.flexible && form.ports.every((p) => p.name.trim() === "")) {
    issues.push({
      severity: "error",
      message: "ポートを 1 つ以上入力してください(フレキシブルなら省略できます)",
    });
  }
  const result = parseModelDefinition(text);
  // ID とポートの有無はここで確かめたので、読み込みの同じ内容のエラーは重ねて出さない
  for (const issue of result.issues) {
    if (/^(id |ports がありません)/.test(issue.message)) continue;
    issues.push({ severity: issue.severity, message: issue.message });
  }
  const ok = result.ok && !issues.some((i) => i.severity === "error");
  return {
    text,
    issues,
    model: ok && result.ok ? result.model : undefined,
    ports: result.ok ? result.model.ports : previewPorts(form),
  };
}

/** エラーのある行を除いて、展開したポートを並べる(入力の途中でもプレビューを出すため) */
function previewPorts(form: ModelForm): PortDef[] {
  const ports: PortDef[] = [];
  for (const row of form.ports) {
    if (row.name.trim() === "") continue;
    const single = parseModelDefinition(
      `id: x\nrole: generic\nports:\n  - name: ${JSON.stringify(row.name.trim())}\n    type: ${row.type}\n`,
    );
    if (single.ok) ports.push(...single.model.ports);
  }
  return ports;
}

/** 複製するときの ID(`<元の id>-copy`、使われていれば `-copy2` …) */
export function copyModelId(id: string, used: (id: string) => boolean): string {
  for (let n = 1; ; n++) {
    const candidate = `${id}-copy${n === 1 ? "" : n}`;
    if (!used(candidate)) return candidate;
  }
}
