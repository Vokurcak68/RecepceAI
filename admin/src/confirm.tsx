// Hezké potvrzovací modální okno místo nativního confirm().
// Použití: const confirm = useConfirm(); if (await confirm({ message, ... })) { … }
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type Opts = { title?: string; message: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Req = Opts & { resolve: (v: boolean) => void };

const Ctx = createContext<(o: Opts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<Req | null>(null);
  const confirm = useCallback((o: Opts) => new Promise<boolean>((resolve) => setReq({ ...o, resolve })), []);
  const close = (v: boolean) => { setReq((cur) => { cur?.resolve(v); return null; }); };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {req && (
        <div className="cm-backdrop" onClick={() => close(false)} onKeyDown={(e) => { if (e.key === "Escape") close(false); }}>
          <div className="cm-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="cm-title">{req.title ?? "Potvrzení"}</div>
            <div className="cm-msg">{req.message}</div>
            <div className="cm-actions">
              <button className="btn ghost" onClick={() => close(false)}>{req.cancelLabel ?? "Zrušit"}</button>
              <button className={`btn ${req.danger ? "danger" : "ok"}`} autoFocus onClick={() => close(true)}>{req.confirmLabel ?? "Potvrdit"}</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
