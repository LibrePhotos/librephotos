/**
 * False until the screen has painted and the navigation transition has settled,
 * then true forever.
 *
 * The viewer's job on its first frame is one thing: show the photo that was
 * tapped. Everything else it does — parsing a cached detail payload through zod,
 * fetching photo details, warming neighbour thumbnails — is work the user has
 * not asked to wait for, and all of it used to run during the mount render. Gate
 * it on this and the sheet fills in a beat later while the photo is already up.
 */
import { useEffect, useState } from "react";
import { InteractionManager } from "react-native";

export function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, []);
  return ready;
}
