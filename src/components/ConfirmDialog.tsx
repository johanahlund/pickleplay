"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  // When set, the dialog shows a text input and the confirm button stays
  // disabled until the user types this exact string (case-sensitive).
  // For destructive operations like deleting a club, league, or account.
  requireType?: string;
  // Smaller body font for long-form messages (e.g., invite-link receipt).
  // Defaults to "text-sm" when unset.
  messageSize?: "xs" | "sm";
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (message: string, title?: string, opts?: { messageSize?: "xs" | "sm" }) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextType>({
  confirm: () => Promise.resolve(false),
  alert: () => Promise.resolve(),
});

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typedValue, setTypedValue] = useState("");

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setTypedValue("");
      setDialog({ ...options, resolve });
    });
  }, []);

  const alertFn = useCallback((message: string, title?: string, opts?: { messageSize?: "xs" | "sm" }): Promise<void> => {
    return new Promise((resolve) => {
      setTypedValue("");
      setDialog({ message, title, confirmText: "OK", messageSize: opts?.messageSize, resolve: () => { resolve(); return true; } });
    });
  }, []);

  const handleClose = (result: boolean) => {
    dialog?.resolve(result);
    setDialog(null);
    setTypedValue("");
  };

  const typeGate = !!dialog?.requireType;
  const typeOk = typeGate ? typedValue === dialog!.requireType : true;

  return (
    <ConfirmContext.Provider value={{ confirm, alert: alertFn }}>
      {children}
      {dialog && (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={() => handleClose(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 space-y-3">
              {dialog.title && <h3 className="font-bold text-lg mb-2">{dialog.title}</h3>}
              <p className={`${dialog.messageSize === "xs" ? "text-xs" : "text-sm"} text-foreground whitespace-pre-line`}>{dialog.message}</p>
              {typeGate && (
                <div>
                  <p className="text-xs text-muted mb-1">
                    Type <span className="font-mono font-semibold text-foreground">{dialog.requireType}</span> to confirm.
                  </p>
                  <input
                    type="text"
                    autoFocus
                    value={typedValue}
                    onChange={(e) => setTypedValue(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-300"
                    placeholder=""
                  />
                </div>
              )}
            </div>
            <div className="flex border-t border-border">
              {dialog.cancelText !== undefined || !dialog.confirmText?.match(/^OK$/i) ? (
                <>
                  <button onClick={() => handleClose(false)}
                    className="flex-1 py-3 text-sm font-medium text-muted hover:bg-gray-50 border-r border-border">
                    {dialog.cancelText || "Cancel"}
                  </button>
                  <button
                    onClick={() => handleClose(true)}
                    disabled={!typeOk}
                    className={`flex-1 py-3 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed ${dialog.danger ? "text-red-600" : "text-action"}`}>
                    {dialog.confirmText || "OK"}
                  </button>
                </>
              ) : (
                <button onClick={() => handleClose(true)}
                  className="flex-1 py-3 text-sm font-semibold text-action hover:bg-gray-50">
                  {dialog.confirmText || "OK"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
