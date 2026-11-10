/**
 * The hashing worker (a module worker, see chunkedUpload.ts): MD5 of a multi-GB video takes many
 * seconds, which the page's main thread would spend frozen.
 */
import { answerHashRequest, isHashRequest, type HashMessage } from "./md5Hashing";

addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isHashRequest(event.data)) return;
  void answerHashRequest(event.data, (message: HashMessage) => postMessage(message));
});
