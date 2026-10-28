// 問題パネル(SPEC 4.5・6章)。エラーを先、警告を後に並べ、項目をクリックすると対象を選んで表示を合わせ、
// YAML エディタの該当箇所にも移る。

import { type Issue, lineColumn } from "../../core";
import { topologyStore, uiStore, useTopology, useUi } from "../../store";
import { useIfNameFormatter } from "../ifNames";
import { describeTarget, issueFocus } from "./targets";
import "./ProblemsPanel.css";

export function ProblemsPanel() {
  const issues = useTopology((s) => s.issues);
  const topology = useTopology((s) => s.topology);
  const yamlText = useTopology((s) => s.yamlText);
  const showYaml = useUi((s) => s.view.showYaml);
  const show = useIfNameFormatter();

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const select = (issue: Issue) => {
    if (issue.range && showYaml) uiStore.getState().jumpToYaml(issue.range);
    const focus = issueFocus(issue.target, topology);
    if (!focus) return;
    uiStore.getState().setMode("select");
    topologyStore.getState().setSelection(focus.selection);
    if (focus.devices.length > 0) uiStore.getState().requestView({ focus: focus.devices });
  };

  return (
    <section className="problems" aria-label="問題">
      <header className="problems-header">
        <h2>問題</h2>
        <span className="problems-counts">
          エラー {errors.length} 件・警告 {warnings.length} 件
        </span>
        <button
          type="button"
          className="problems-close"
          aria-label="問題パネルを閉じる"
          title="閉じる"
          onClick={() => uiStore.getState().setProblemsOpen(false)}
        >
          ×
        </button>
      </header>
      {issues.length === 0 ? (
        <p className="problems-empty">問題はありません</p>
      ) : (
        <ul className="problems-list">
          {[...errors, ...warnings].map((issue, i) => {
            // 行番号は、今の YAML(エディタの内容)の位置
            const line = issue.range ? lineColumn(yamlText, issue.range.start).line : undefined;
            return (
              <li key={i}>
                <button
                  type="button"
                  className={`problem problem-${issue.severity}`}
                  onClick={() => select(issue)}
                >
                  <span
                    className="problem-icon"
                    aria-label={issue.severity === "error" ? "エラー" : "警告"}
                  >
                    {issue.severity === "error" ? "✕" : "⚠"}
                  </span>
                  <span className="problem-message">{issue.message}</span>
                  <span className="problem-target">
                    {describeTarget(issue.target, topology, show)}
                  </span>
                  {line !== undefined && (
                    <span className="problem-line" title="YAML の行">
                      {line} 行目
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
