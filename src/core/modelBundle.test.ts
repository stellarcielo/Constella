import { describe, expect, it } from "vitest";
import { ICON_MAX_BYTES } from "./icons";
import {
  base64Bytes,
  iconsToWrite,
  type ImportCurrent,
  modelBundleText,
  parseModelBundle,
  planModelImport,
} from "./modelBundle";

const sw = `# 自分のスイッチ
id: my-sw
role: l2switch
icon: switch.svg
ports:
  - name: "ge{1-8}"
    type: rj45
`;
const fw = "id: my-fw\nrole: firewall\nflexible: true\n";

function parse(text: string) {
  const result = parseModelBundle(text);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("modelBundleText・parseModelBundle(SPEC 5.5)", () => {
  it("書き出して読み戻すと、モデルの YAML はコメントも含めて書いたとおり", () => {
    const bundle = {
      models: [
        { file: "my-sw.yaml", text: sw },
        { file: "my-fw.yaml", text: fw.trimEnd() },
      ],
      icons: [{ file: "switch.svg", base64: btoa("<svg/>") }],
    };
    const text = modelBundleText(bundle);
    expect(text).toContain("constella-models: 1\n");
    expect(text).toContain("    text: |\n      # 自分のスイッチ\n      id: my-sw\n");
    const back = parse(text);
    expect(back.bundle).toEqual(bundle);
    expect(back.problems).toEqual([]);
    expect(new TextDecoder().decode(base64Bytes(back.bundle.icons[0].base64))).toBe("<svg/>");
  });

  it("印が無い・版が違う・YAML でなければ読めない", () => {
    expect(parseModelBundle("constella: 1\ndevices: {}\n")).toMatchObject({ ok: false });
    expect(parseModelBundle("constella-models: 2\n")).toEqual({
      ok: false,
      error: "constella-models の版「2」には対応していません",
    });
    expect(parseModelBundle("constella-models: [\n")).toMatchObject({ ok: false });
  });

  it("読めない項目は飛ばして、問題として返す", () => {
    const big = btoa("x".repeat(ICON_MAX_BYTES + 1));
    const result = parse(`constella-models: 1
models:
  - file: a.yaml
  - file: b.yaml
    text: "id: b\\nrole: pc\\nflexible: true\\n"
icons:
  - file: ../evil.svg
    data: ${btoa("<svg/>")}
  - file: big.png
    data: ${big}
  - file: bad.png
    data: "%%%"
`);
    expect(result.bundle.models.map((m) => m.file)).toEqual(["b.yaml"]);
    expect(result.bundle.icons).toEqual([]);
    expect(result.problems).toEqual([
      "models の 1 番目に file と text がありません",
      "../evil.svg は、アイコンの画像のファイル名(.svg・.png)ではありません",
      "big.png は 1 MB を超えているので取り込みません",
      "bad.png の中身(data)が読めません",
    ]);
  });
});

describe("planModelImport", () => {
  const empty: ImportCurrent = { models: [], builtinIds: new Set(), icons: new Map() };

  it("新しいモデルは <id>.yaml に書く。組み込みと同じ ID なら置き換える印を付ける", () => {
    const plan = planModelImport(
      {
        models: [
          { file: "x.yaml", text: fw },
          { file: "r.yaml", text: "id: generic-router-4\nrole: router\nflexible: true\n" },
        ],
        icons: [],
      },
      { ...empty, builtinIds: new Set(["generic-router-4"]) },
    );
    expect(plan.models.map((m) => [m.id, m.status, m.target, m.replacesBuiltin])).toEqual([
      ["my-fw", "new", "my-fw.yaml", undefined],
      ["generic-router-4", "new", "generic-router-4.yaml", true],
    ]);
  });

  it("同じ ID のユーザーモデルと比べ、中身が同じなら same、違えば changed(書くのは今のファイル)", () => {
    const current: ImportCurrent = {
      ...empty,
      models: [
        { file: "fw.yaml", text: fw, id: "my-fw" },
        { file: "old-sw.yaml", text: "id: my-sw\nrole: l2switch\nflexible: true\n", id: "my-sw" },
      ],
    };
    const plan = planModelImport(
      {
        models: [
          { file: "my-fw.yaml", text: fw },
          { file: "my-sw.yaml", text: sw },
        ],
        icons: [{ file: "switch.svg", base64: "AAAA" }],
      },
      current,
    );
    expect(plan.models.map((m) => [m.id, m.status, m.target])).toEqual([
      ["my-fw", "same", "fw.yaml"],
      ["my-sw", "changed", "old-sw.yaml"],
    ]);
  });

  it("読めないモデルと、まとめたファイルの中で重なる ID は取り込まない", () => {
    const plan = planModelImport(
      {
        models: [
          { file: "a.yaml", text: "role: pc\n" },
          { file: "b.yaml", text: fw },
          { file: "c.yaml", text: fw },
        ],
        icons: [],
      },
      empty,
    );
    expect(plan.models.map((m) => [m.file, m.status])).toEqual([
      ["a.yaml", "invalid"],
      ["b.yaml", "new"],
      ["c.yaml", "invalid"],
    ]);
    expect(plan.models[2].reason).toBe("同じ ID が前にもあります");
  });

  it("画像: 同じ名前・同じ中身なら今のものを使い、中身が違えば名前を変えて、モデルの icon も書き換える", () => {
    const same = planModelImport(
      {
        models: [{ file: "my-sw.yaml", text: sw }],
        icons: [{ file: "switch.svg", base64: "AAAA" }],
      },
      { ...empty, icons: new Map([["switch.svg", "AAAA"]]) },
    );
    expect(same.icons).toEqual([
      { from: "switch.svg", file: "switch.svg", base64: "AAAA", status: "same" },
    ]);
    expect(same.models[0].text).toBe(sw);

    const other = planModelImport(
      {
        models: [{ file: "my-sw.yaml", text: sw }],
        icons: [{ file: "switch.svg", base64: "BBBB" }],
      },
      { ...empty, icons: new Map([["switch.svg", "AAAA"]]) },
    );
    expect(other.icons).toEqual([
      { from: "switch.svg", file: "switch-2.svg", base64: "BBBB", status: "renamed" },
    ]);
    // icon の行だけを変え、コメントなどはそのまま
    expect(other.models[0].text).toBe(sw.replace("icon: switch.svg", "icon: switch-2.svg"));
  });

  it("名前が重なっても、同じ中身の画像が別の名前であればそれを使う(取り込み直しても増やさない)", () => {
    const plan = planModelImport(
      {
        models: [{ file: "my-sw.yaml", text: sw }],
        icons: [{ file: "switch.svg", base64: "BBBB" }],
      },
      {
        ...empty,
        models: [
          { file: "my-sw.yaml", text: sw.replace("switch.svg", "switch-2.svg"), id: "my-sw" },
        ],
        icons: new Map([
          ["switch.svg", "AAAA"],
          ["switch-2.svg", "BBBB"],
        ]),
      },
    );
    expect(plan.icons).toEqual([
      { from: "switch.svg", file: "switch-2.svg", base64: "BBBB", status: "same" },
    ]);
    expect(plan.models.map((m) => m.status)).toEqual(["same"]);
  });

  it("iconsToWrite は、書き込むモデルが使う画像のうち、今と同じでないものだけ", () => {
    const plan = planModelImport(
      {
        models: [
          { file: "my-sw.yaml", text: sw },
          { file: "my-fw.yaml", text: fw.replace("flexible", "icon: fw.png\nflexible") },
        ],
        icons: [
          { file: "switch.svg", base64: "AAAA" },
          { file: "fw.png", base64: "CCCC" },
        ],
      },
      { ...empty, icons: new Map([["switch.svg", "AAAA"]]) },
    );
    expect(iconsToWrite(plan, plan.models).map((i) => i.file)).toEqual(["fw.png"]);
    expect(iconsToWrite(plan, [plan.models[0]])).toEqual([]);
  });
});
