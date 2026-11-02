/**
 * False until the screen has painted and the navigation transition has settled,
 * then true forever.
 *
 * The viewer's job on its first frame is one thing: show the photo that was
 * tapped. Everything else it does — parsing a cached detail payload through zod,
 * fetching photo details, warming neighbour thumbnails — is work the user has
 * not asked to wait for, and all of it used to run during the mount render. Gate
 * it on this and the sheet fills in a beat later while the photo is already up.
 *
 * `requestIdleCallback` replaces `InteractionManager.runAfterInteractions`,
 * which React Native deprecated; the timeout caps the wait on a busy JS thread.
 */
import { useEffect, useState } from "react";

const MAX_WAIT_MS = 500;

export function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const handle = requestIdleCallback(() => setReady(true), { timeout: MAX_WAIT_MS });
    return () => cancelIdleCallback(handle);
  }, []);
  return ready;
}
