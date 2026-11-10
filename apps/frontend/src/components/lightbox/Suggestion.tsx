import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { MentionList, type MentionListHandle, type MentionListProps } from "./MentionList";
import { openSuggestionPopup, type SuggestionPopup } from "./suggestionPopup";

/** The hashtag suggestion popup: the caption editor supplies the items. */
const suggestion: Pick<SuggestionOptions<string, MentionNodeAttrs>, "char" | "render"> = {
  char: "#",

  render: () => {
    let reactRenderer: ReactRenderer<MentionListHandle, MentionListProps> | undefined;
    let popup: SuggestionPopup | undefined;
    // The last rect the popup was placed against. The plugin calls render()
    // once per editor, so every getter handed to the popup (onStart and each
    // onUpdate) reads and updates this one.
    let lastRect = new DOMRect();

    /**
     * Where the popup is anchored. The plugin answers null while the
     * decoration it measures is not in the DOM; the popup cannot be placed
     * against null, so it stays where it last was (the viewport origin only
     * if it was never placed).
     */
    const anchoredTo = (clientRect: () => DOMRect | null) => (): DOMRect => (lastRect = clientRect() ?? lastRect);

    return {
      onStart: props => {
        if (!props.clientRect) {
          return;
        }

        reactRenderer = new ReactRenderer(MentionList, {
          props,
          editor: props.editor,
        });
        popup = openSuggestionPopup(reactRenderer.element, anchoredTo(props.clientRect), props.editor.view.dom);
      },

      onUpdate(props) {
        reactRenderer?.updateProps(props);

        if (!props.clientRect) {
          return;
        }

        popup?.reanchor(anchoredTo(props.clientRect));
      },

      onKeyDown(props) {
        if (props.event.key === "Escape") {
          popup?.hide();

          return true;
        }

        return reactRenderer?.ref?.onKeyDown(props) ?? false;
      },

      onExit() {
        popup?.destroy();
        popup = undefined;
        reactRenderer?.destroy();
        reactRenderer = undefined;
      },
    };
  },
};

export default suggestion;
