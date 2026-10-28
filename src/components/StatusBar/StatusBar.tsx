// 下端のステータスバー: ファイル名 / 未保存の印 / エラーと警告の件数(SPEC 6章)。

import { documentName } from "../../commands";
import { useTopology } from "../../store";
import "./StatusBar.css";

export function StatusBar() {
  const issues = useTopology((s) => s.issues);
  const filePath = useTopology((s) => s.filePath);
  const dirty = useTopology((s) => s.dirty);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return (
    <footer className="statusbar">
      <span className="statusbar-file" title={filePath}>
        {documentName(filePath)}
      </span>
      {dirty && <span className="statusbar-dirty">● 未保存</span>}
      <span className="statusbar-spacer" />
      <span className={errors > 0 ? "statusbar-errors" : undefined}>エラー {errors} 件</span>
      <span className={warnings > 0 ? "statusbar-warnings" : undefined}>警告 {warnings} 件</span>
    </footer>
  );
}
