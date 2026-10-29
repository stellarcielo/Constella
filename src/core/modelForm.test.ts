import { describe, expect, it } from "vitest";
import {
  checkModelForm,
  copyModelId,
  emptyModelForm,
  type ModelForm,
  modelFormFromText,
  modelFormToText,
} from "./modelForm";
import { parseModelDefinition } from "./modelLibrary";

/** SPEC 5.1 の例 */
const c2960 = `id: cisco-c2960-24tt-l
vendor: Cisco
name: Catalyst 2960-24TT-L
role: l2switch
ports:
  - name: "FastEthernet0/{1-24}"
    type: rj45
    speed: 100M
  - name: "GigabitEthernet0/{1-2}"
    type: rj45
    speed: 1G
`;

const form = (fields: Partial<ModelForm>): ModelForm => ({ ...emptyModelForm(), ...fields });

describe("modelFormFromText / modelFormToText", () => {
  it("ポートを連番のパターンのまま読み、同じ形の YAML に戻す", () => {
    const f = modelFormFromText(c2960);
    expect(f).toEqual({
      id: "cisco-c2960-24tt-l",
      vendor: "Cisco",
      name: "Catalyst 2960-24TT-L",
      role: "l2switch",
      flexible: false,
      guest: "",
      ports: [
        { name: "FastEthernet0/{1-24}", type: "rj45", speed: "100M" },
        { name: "GigabitEthernet0/{1-2}", type: "rj45", speed: "1G" },
      ],
      extra: {},
    });
    expect(f && modelFormToText(f)).toBe(c2960);
  });

  it("フォームで扱わない項目(icon や未知のキー)は残す", () => {
    const f = modelFormFromText(`${c2960}icon: switch-x\nnote: { a: 1 }\n`);
    expect(f?.extra).toEqual({ icon: "switch-x", note: { a: 1 } });
    const back = f && modelFormToText(f);
    expect(back).toContain("icon: switch-x");
    expect(back && parseModelDefinition(back)).toMatchObject({
      ok: true,
      model: { icon: "switch-x" },
    });
  });

  it("空の項目は書かず、数字だけの値や記号を含む値は引用符で囲む", () => {
    const text = modelFormToText(
      form({
        id: "edge-10",
        vendor: "A: B",
        name: "2960",
        role: "router",
        flexible: true,
        ports: [{ name: "  ", type: "rj45", speed: "" }],
      }),
    );
    expect(text).toBe('id: edge-10\nvendor: "A: B"\nname: "2960"\nrole: router\nflexible: true\n');
  });

  it("guest を読み書きする(フェーズ4-1)", () => {
    const text =
      'id: my-vm\nrole: firewall\nflexible: true\nguest: vm\nports:\n  - name: "net{0-1}"\n    type: virtual\n';
    const f = modelFormFromText(text);
    expect(f?.guest).toBe("vm");
    expect(f && modelFormToText(f)).toBe(text);
    expect(modelFormFromText("id: a\nrole: server\nguest: lxc\n")?.guest).toBe("");
  });

  it("YAML でなければ undefined", () => {
    expect(modelFormFromText("ports: [\n")).toBeUndefined();
    expect(modelFormFromText("- a\n")).toBeUndefined();
  });
});

describe("checkModelForm", () => {
  it("空のフォームは ID とポートが無いことだけを知らせる", () => {
    expect(checkModelForm(emptyModelForm()).issues.map((i) => i.message)).toEqual([
      "ID を入力してください",
      "ポートを 1 つ以上入力してください(フレキシブルなら省略できます)",
    ]);
  });

  it("正しければモデルと、連番を展開したポートを返す", () => {
    const f = modelFormFromText(c2960) as ModelForm;
    const result = checkModelForm(f);
    expect(result.issues).toEqual([]);
    expect(result.model?.ports).toHaveLength(26);
    expect(result.ports[0]).toEqual({ name: "Fa0/1", type: "rj45", speed: "100M" });
  });

  it("ファイル名にできない ID、連番の誤り、ポートの重複はエラー", () => {
    const messages = (f: ModelForm) => checkModelForm(f).issues.map((i) => i.message);
    expect(
      messages(form({ id: "bad id", ports: [{ name: "eth0", type: "rj45", speed: "" }] })),
    ).toEqual(["ID「bad id」は使えません(英数字で始まり、英数字と . _ - だけを使えます)"]);
    const broken = checkModelForm(
      form({
        id: "x",
        ports: [
          { name: "Gi0/{1-4}", type: "rj45", speed: "" },
          { name: "GigabitEthernet0/4", type: "sfp", speed: "" },
          { name: "Te0/{5-", type: "sfp+", speed: "" },
        ],
      }),
    );
    expect(broken.model).toBeUndefined();
    expect(broken.issues.map((i) => i.message).join("\n")).toMatch(/重なっています/);
    expect(broken.issues.length).toBe(2);
    // 誤りのある行を除いて、展開したポートをプレビューに出す
    expect(broken.ports.map((p) => p.name)).toEqual(["Gi0/1", "Gi0/2", "Gi0/3", "Gi0/4", "Gi0/4"]);
  });

  it("フレキシブルならポートが無くてもよい", () => {
    expect(
      checkModelForm(form({ id: "cloud-x", role: "cloud", flexible: true, ports: [] })).model,
    ).toMatchObject({
      id: "cloud-x",
      flexible: true,
      ports: [],
    });
  });
});

describe("copyModelId", () => {
  it("-copy を付け、使われていれば番号を足す", () => {
    const used = new Set(["sw", "sw-copy"]);
    expect(copyModelId("rt", (id) => used.has(id))).toBe("rt-copy");
    expect(copyModelId("sw", (id) => used.has(id))).toBe("sw-copy2");
  });
});
