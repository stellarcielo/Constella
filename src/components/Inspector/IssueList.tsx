// 選んでいる要素のエラー・警告の一覧。

import type { Issue } from "../../core";

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="issue-list">
      {issues.map((issue, i) => (
        <li key={i} className={`issue issue-${issue.severity}`}>
          <span className="issue-icon" aria-label={issue.severity === "error" ? "エラー" : "警告"}>
            {issue.severity === "error" ? "✕" : "⚠"}
          </span>
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
