// YAML エディタ(SPEC 6章・8章)。CodeMirror 6。
// - 打ち込んだ内容はストアに渡し、300ms 何も打たなければ読み込む(SPEC 8.1)
// - GUI やファイルから YAML が変わったら、変わった部分だけをエディタに反映する(カーソル位置を保つ)。
//   エディタ自身の変更(出どころ "yaml")は書き戻さない
// - 構文エラーと、位置の分かる問題に下線を引く(フェーズ2-1 Q3)
// - 問題パネルからのジャンプ(フェーズ2-1 Q4)

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { type Diagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Annotation, EditorState, type Extension, Transaction } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import type { Issue } from "../../core";
import { topologyStore, uiStore } from "../../store";
import "./YamlEditor.css";

/** 打ち込み終わってから読み込むまでの時間(SPEC 8.1) */
const DEBOUNCE_MS = 300;

/** ストアから反映した変更の印(エディタの変更としてストアに返さない) */
const fromStore = Annotation.define<boolean>();

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "var(--yaml-comment)", fontStyle: "italic" },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--yaml-key)" },
  { tag: [tags.string, tags.special(tags.string), tags.content], color: "var(--yaml-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--yaml-number)" },
  { tag: [tags.keyword, tags.typeName, tags.labelName, tags.meta], color: "var(--yaml-meta)" },
  {
    tag: [tags.punctuation, tags.separator, tags.squareBracket, tags.brace],
    color: "var(--text-muted)",
  },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12px", backgroundColor: "var(--bg)", color: "var(--text)" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.5",
  },
  ".cm-content": { caretColor: "var(--text)" },
  ".cm-gutters": {
    backgroundColor: "var(--panel)",
    color: "var(--text-muted)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--active-line)" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    { backgroundColor: "var(--selection)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--text)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-searchMatch": { backgroundColor: "var(--search-match)" },
  ".cm-tooltip": {
    backgroundColor: "var(--panel)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
});

function extensions(onDocChanged: (text: string) => void): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    yaml(),
    syntaxHighlighting(highlightStyle),
    lintGutter(),
    theme,
    EditorView.contentAttributes.of({
      "aria-label": "YAML エディタ",
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.transactions.some((tr) => tr.annotation(fromStore))) return;
      onDocChanged(update.state.doc.toString());
    }),
  ];
}

/** 位置の分かる問題を、エディタの下線にする */
function diagnostics(issues: Issue[], length: number): Diagnostic[] {
  return issues.flatMap((issue) => {
    if (!issue.range) return [];
    const from = Math.min(issue.range.start, length);
    const to = Math.min(Math.max(issue.range.end, from), length);
    return [{ from, to, severity: issue.severity, message: issue.message }];
  });
}

/** 前後の一致する部分を残して、変わった部分だけを置き換える(カーソル位置が保たれる) */
function replaceText(view: EditorView, text: string): void {
  const current = view.state.doc.toString();
  if (current === text) return;
  let start = 0;
  const max = Math.min(current.length, text.length);
  while (start < max && current.charCodeAt(start) === text.charCodeAt(start)) start++;
  let endA = current.length;
  let endB = text.length;
  while (
    endA > start &&
    endB > start &&
    current.charCodeAt(endA - 1) === text.charCodeAt(endB - 1)
  ) {
    endA--;
    endB--;
  }
  view.dispatch({
    changes: { from: start, to: endA, insert: text.slice(start, endB) },
    // GUI の変更はエディタの取り消し履歴に入れない(アプリ全体の取り消しは次のタスクで整理する)
    annotations: [fromStore.of(true), Transaction.addToHistory.of(false)],
  });
}

export function YamlEditor() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onDocChanged = (text: string) => {
      topologyStore.getState().setYamlDraft(text);
      clearTimeout(timer);
      timer = setTimeout(() => topologyStore.getState().commitYamlDraft(), DEBOUNCE_MS);
    };
    const createState = (doc: string) =>
      EditorState.create({ doc, extensions: extensions(onDocChanged) });

    const view = new EditorView({ parent, state: createState(topologyStore.getState().yamlText) });
    const syncDiagnostics = () =>
      view.dispatch(
        setDiagnostics(
          view.state,
          diagnostics(topologyStore.getState().issues, view.state.doc.length),
        ),
      );
    syncDiagnostics();

    const unsubscribeStore = topologyStore.subscribe((state, prev) => {
      if (state.yamlText !== prev.yamlText && state.yamlOrigin !== "yaml") {
        // ファイルを開いたときは取り消し履歴ごと入れ替える。GUI の変更は差分だけ反映する
        if (state.yamlOrigin === "file") view.setState(createState(state.yamlText));
        else replaceText(view, state.yamlText);
      }
      if (state.issues !== prev.issues || state.yamlText !== prev.yamlText) syncDiagnostics();
    });
    const unsubscribeUi = uiStore.subscribe((state, prev) => {
      const range = state.editorJump.range;
      if (state.editorJump === prev.editorJump || !range) return;
      const length = view.state.doc.length;
      view.dispatch({
        selection: { anchor: Math.min(range.start, length), head: Math.min(range.end, length) },
        scrollIntoView: true,
      });
    });

    return () => {
      unsubscribeStore();
      unsubscribeUi();
      clearTimeout(timer);
      // 閉じる前に、打ち込み中の内容を読み込む
      topologyStore.getState().commitYamlDraft();
      view.destroy();
    };
  }, []);

  return <div className="yaml-editor" ref={host} />;
}
