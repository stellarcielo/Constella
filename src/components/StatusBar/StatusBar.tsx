// 下端のステータスバー: ファイル名 / 未保存の印 / エラーと警告の件数(SPEC 6章)。
// 件数をクリックすると問題パネルを開け閉めする。

import { documentName } from "../../commands";
import { uiStore, useTopology, useUi } from "../../store";
import "./StatusBar.css";

export function StatusBar() {
  const issues = useTopology((s) => s.issues);
  const filePath = useTopology((s) => s.filePath);
  const dirty = useTopology((s) => s.dirty);
  const problemsOpen = useUi((s) => s.problemsOpen);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return (
    <footer className="statusbar">
      <span className="statusbar-file" title={filePath}>
        {documentName(filePath)}
      </span>
      {dirty && <span className="statusbar-dirty">● 未保存</span>}
      <span className="statusbar-spacer" />
      <button
        type="button"
        className="statusbar-problems"
        aria-expanded={problemsOpen}
        title={problemsOpen ? "問題パネルを閉じる" : "問題パネルを開く"}
        onClick={() => uiStore.getState().setProblemsOpen(!problemsOpen)}
      >
        <span className={errors > 0 ? "statusbar-errors" : undefined}>エラー {errors} 件</span>
        <span className={warnings > 0 ? "statusbar-warnings" : undefined}>警告 {warnings} 件</span>
      </button>
    </footer>
  );
}
