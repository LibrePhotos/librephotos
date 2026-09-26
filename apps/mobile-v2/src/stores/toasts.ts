import { create } from "zustand";

/**
 * Transient toast queue (client state). The outbox replay engine pushes a toast
 * when a queued mutation is dropped (server rejected it with a 4xx); the app
 * chrome renders + auto-dismisses them. Kept tiny and UI-agnostic so the sync
 * layer can enqueue without importing any RN surface.
 */
export type Toast = { id: number; level: "error" | "info"; message: string };

type ToastState = {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++seq }].slice(-4) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
