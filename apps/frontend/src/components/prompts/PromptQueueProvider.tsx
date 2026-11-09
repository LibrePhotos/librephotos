import React, { useEffect, useState, type ReactNode } from "react";
import { useUpload } from "../upload";
import { createPromptQueue, PromptQueueContext } from "./promptQueue";

/**
 * The one queue of the app shell's prompts (`usePromptTurn`): one dialog at a time, none opening by
 * itself while files upload. Inside the upload provider.
 */
export function PromptQueueProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { items: uploads } = useUpload();
  const quiet = uploads.length === 0;
  const [queue] = useState(() => createPromptQueue(quiet));
  useEffect(() => queue.setQuiet(quiet), [queue, quiet]);
  return <PromptQueueContext.Provider value={queue}>{children}</PromptQueueContext.Provider>;
}
