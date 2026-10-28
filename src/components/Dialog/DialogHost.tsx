// askDialog で頼まれたダイアログを表示する。App に 1 つだけ置く。

import { useStore } from "zustand";
import { ConfirmDialog } from "./ConfirmDialog";
import { dialogStore } from "./dialogs";

export function DialogHost() {
  const request = useStore(dialogStore, (s) => s.request);
  if (!request) return null;
  const close = (value: string | null) => {
    dialogStore.setState({ request: null });
    request.resolve(value);
  };
  return (
    <ConfirmDialog
      title={request.title}
      actions={request.actions}
      cancelLabel={request.cancelLabel}
      onAction={close}
      onCancel={() => close(null)}
    >
      <p>{request.message}</p>
      {request.details && request.details.length > 0 && (
        <ul>
          {request.details.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </ConfirmDialog>
  );
}
