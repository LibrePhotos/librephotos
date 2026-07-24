/**
 * Kicks off the initial full seed once after login when the mirror has never
 * been fully synced. Renders nothing; runs inside the DbProvider so it can read
 * the mirror's sync_state and write through the same DB handle.
 */
import { useEffect, useRef } from "react";
import { useDb } from "@/db/provider";
import { apiClient } from "@/lib/apiClient";
import { useAuthStore } from "@/stores/auth";
import { needsInitialSeed, runSeed } from "./coordinator";

export function SeedOnLogin() {
  const db = useDb();
  const userId = useAuthStore((s) => s.userId);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || userId == null) return;
    if (!needsInitialSeed(db)) return;
    started.current = true;
    void runSeed(db, apiClient, { userId }).catch(() => {
      // Failures leave sync_state "running"; the next launch / pull resumes.
      started.current = false;
    });
  }, [db, userId]);

  return null;
}
