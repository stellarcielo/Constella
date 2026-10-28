// 下端のステータスバー。ファイル名と未保存マークはファイル操作のタスクで追加する。

import { useTopology } from "../../store";
import "./StatusBar.css";

export function StatusBar() {
  const issues = useTopology((s) => s.issues);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return (
    <footer className="statusbar">
      <span className="statusbar-spacer" />
      <span className={errors > 0 ? "statusbar-errors" : undefined}>エラー {errors} 件</span>
      <span className={warnings > 0 ? "statusbar-warnings" : undefined}>警告 {warnings} 件</span>
    </footer>
  );
}
