"use client";

import { useState, useEffect, createContext, useContext, useCallback } from "react";

interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  text: string;
}

const ToastContext = createContext<{
  show: (type: "success" | "error" | "info", text: string) => void;
}>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const show = useCallback((type: "success" | "error" | "info", text: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* Toast container */}
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[300] space-y-2 pointer-events-none max-w-[500px] w-full px-4">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-xl px-4 py-3 shadow-lg text-sm font-medium text-center animate-fade-in ${
            t.type === "success" ? "bg-green-600 text-white" :
            t.type === "error" ? "bg-danger text-white" :
            "bg-foreground text-white"
          }`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
