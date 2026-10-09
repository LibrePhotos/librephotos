/**
 * Whether this browser can play a video as it is, or needs it converted.
 *
 * Only the browser knows. HEVC is the common case: Safari plays it, Chrome and
 * Edge play it where the machine has a hardware decoder, Firefox mostly does
 * not -- and a Chrome without the decoder does not even fail, it plays the
 * sound over a black picture. So the backend describes each video the way
 * `canPlayType` expects (`video_playback_type`, e.g.
 * `video/mp4; codecs="hvc1.2.4.L120.90"`), and the answer decides whether the
 * lightbox asks for the original or for a conversion.
 */

let probe: HTMLVideoElement | null = null;

/**
 * `true` when the browser says it cannot play `type`; `false` when it says it
 * can, or when there is no type to ask about -- a video not probed yet, which
 * is played as it is and converted only if that fails.
 *
 * `canPlayType` answers "", "maybe" or "probably". Only "" is a no: "maybe" is
 * what browsers say for types they will attempt, and the player falls back to
 * a conversion should the attempt fail.
 */
export function needsConversion(type: string | null | undefined): boolean {
  if (!type || typeof document === "undefined") return false;
  probe ??= document.createElement("video");
  return probe.canPlayType(type) === "";
}

/** The same video URL, asking the backend to convert it. */
export function convertedUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}transcode=1`;
}
