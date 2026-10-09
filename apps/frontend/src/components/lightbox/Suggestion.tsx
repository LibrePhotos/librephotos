import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import tippy, { type Instance } from "tippy.js";
import { MentionList, type MentionListHandle, type MentionListProps } from "./MentionList";

/** The hashtag suggestion popup: the caption editor supplies the items. */
const suggestion: Pick<SuggestionOptions<string, MentionNodeAttrs>, "char" | "render"> = {
  char: "#",

  render: () => {
    let reactRenderer: ReactRenderer<MentionListHandle, MentionListProps> | undefined;
    let popup: Instance[] | undefined;
    // The last rect the popup was placed against. The plugin calls render()
    // once per editor, so every getter handed to tippy (onStart and each
    // onUpdate) reads and updates this one.
    let lastRect = new DOMRect();

    /**
     * Where the popup is anchored. The plugin answers null while the
     * decoration it measures is not in the DOM; tippy cannot place against
     * null, so the popup stays where it last was (the viewport origin only
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
        popup = tippy("body", {
          getReferenceClientRect: anchoredTo(props.clientRect),
          appendTo: () => document.body,
          content: reactRenderer.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "bottom-start",
        });
      },

      onUpdate(props) {
        reactRenderer?.updateProps(props);

        if (!props.clientRect) {
          return;
        }

        popup?.[0].setProps({
          getReferenceClientRect: anchoredTo(props.clientRect),
        });
      },

      onKeyDown(props) {
        if (props.event.key === "Escape") {
          popup?.[0].hide();

          return true;
        }

        return reactRenderer?.ref?.onKeyDown(props) ?? false;
      },

      onExit() {
        popup?.[0].destroy();
        reactRenderer?.destroy();
      },
    };
  },
};

export default suggestion;
