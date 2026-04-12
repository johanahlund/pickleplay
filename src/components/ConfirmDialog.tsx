"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (message: string, title?: string) => Promise<void>;
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

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialog({ ...options, resolve });
    });
  }, []);

  const alertFn = useCallback((message: string, title?: string): Promise<void> => {
    return new Promise((resolve) => {
      setDialog({ message, title, confirmText: "OK", resolve: () => { resolve(); return true; } });
    });
  }, []);

  const handleClose = (result: boolean) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm, alert: alertFn }}>
      {children}
      {dialog && (
        <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" onClick={() => handleClose(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-5">
              {dialog.title && <h3 className="font-bold text-lg mb-2">{dialog.title}</h3>}
              <p className="text-sm text-foreground">{dialog.message}</p>
            </div>
            <div className="flex border-t border-border">
              {dialog.cancelText !== undefined || !dialog.confirmText?.match(/^OK$/i) ? (
                <>
                  <button onClick={() => handleClose(false)}
                    className="flex-1 py-3 text-sm font-medium text-muted hover:bg-gray-50 border-r border-border">
                    {dialog.cancelText || "Cancel"}
                  </button>
                  <button onClick={() => handleClose(true)}
                    className={`flex-1 py-3 text-sm font-semibold hover:bg-gray-50 ${dialog.danger ? "text-red-600" : "text-action"}`}>
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
