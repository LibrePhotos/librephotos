import { createContext, useContext } from "react";

/**
 * What the lightbox's keyboard shortcuts ask its parts to do. ContentViewer owns the keys and emits;
 * the toolbar and the video player subscribe. ContentViewer creates one instance per lightbox and
 * hands it down by context, so a command reaches the lightbox that asked and no other listener on
 * the page.
 */
export type LightboxCommandArgs = {
  favorite: [];
  hide: [];
  public: [];
  delete: [];
  /** Seconds to move the playhead; negative goes back. */
  seek: [seconds: number];
};

export type LightboxCommand = keyof LightboxCommandArgs;

type LightboxCommandHandler<C extends LightboxCommand> = (...args: LightboxCommandArgs[C]) => void;

export type LightboxCommands = {
  emit: <C extends LightboxCommand>(command: C, ...args: LightboxCommandArgs[C]) => void;
  /** Subscribes to a command; the returned function unsubscribes. */
  on: <C extends LightboxCommand>(command: C, handler: LightboxCommandHandler<C>) => () => void;
};

export function createLightboxCommands(): LightboxCommands {
  const handlers: { [C in LightboxCommand]: Set<LightboxCommandHandler<C>> } = {
    favorite: new Set(),
    hide: new Set(),
    public: new Set(),
    delete: new Set(),
    seek: new Set(),
  };
  return {
    emit(command, ...args) {
      handlers[command].forEach(handler => handler(...args));
    },
    on(command, handler) {
      const subscribers = handlers[command];
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
  };
}

// Outside a lightbox nothing emits and nothing is commanded: the default is inert, so a component
// that also renders on its own page (the video player in the photo route) needs no provider.
const NO_LIGHTBOX: LightboxCommands = {
  emit: () => {},
  on: () => () => {},
};

export const LightboxCommandsContext = createContext<LightboxCommands>(NO_LIGHTBOX);

export function useLightboxCommands(): LightboxCommands {
  return useContext(LightboxCommandsContext);
}
