import { RichTextEditor } from "@mantine/tiptap";
import Document from "@tiptap/extension-document";
import Mention from "@tiptap/extension-mention";
import Paragraph from "@tiptap/extension-paragraph";
import { Text as TipTapText } from "@tiptap/extension-text";
import { useEditor } from "@tiptap/react";
import React, { useEffect, useRef } from "react";
import { fuzzyMatch } from "../../util/util";
import { captionToEditorHtml } from "./captionMarkup";
import classes from "./Description.module.css";
import hashtagClasses from "./Hashtag.module.css";
import suggestion from "./Suggestion";

export type CaptionInputProps = Readonly<{
  /** The text the editor opens with; a new value needs a new editor (a `key`). */
  initialCaption: string;
  /** False while a save runs: the text stays, but cannot be changed. */
  editable: boolean;
  /** The owner's hashtags, offered after a `#`. */
  hashtags: readonly string[];
  onChange: (caption: string) => void;
}>;

/**
 * The caption editor itself: tiptap with hashtags as mentions. Its own chunk (with tiptap and
 * ProseMirror), loaded only when a caption is edited; Description shows a caption that is not
 * being edited as plain text (CaptionText).
 */
export function CaptionInput({ initialCaption, editable, hashtags, onChange }: CaptionInputProps) {
  // The editor reads its extensions once, when it is created, so the hashtag
  // suggestions look the albums up when asked instead of closing over them.
  const hashtagsRef = useRef(hashtags);
  useEffect(() => {
    hashtagsRef.current = hashtags;
  }, [hashtags]);

  const editor = useEditor({
    editable,
    autofocus: editable ? "end" : false,
    extensions: [
      Document,
      Paragraph,
      TipTapText,
      Mention.configure({
        HTMLAttributes: {
          class: hashtagClasses.hashtag,
        },
        // renderLabel is deprecated in tiptap v3 and warns on every render.
        renderText({ options, node }) {
          return `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`;
        },
        renderHTML({ options, node }) {
          return ["span", options.HTMLAttributes, `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`];
        },
        suggestion: {
          items: ({ query }) => {
            const matches = hashtagsRef.current.filter(title => fuzzyMatch(query, title)).slice(0, 5);
            // Offer what was typed as a new hashtag, but not an empty one for a
            // bare "#", and not a second copy of an existing one.
            if (query && !matches.includes(query)) {
              matches.push(query);
            }
            return matches.reverse();
          },
          char: suggestion.char,
          render: suggestion.render,
        },
      }),
    ],
    content: captionToEditorHtml(initialCaption),
    onUpdate({ editor: updated }) {
      onChange(updated.getText());
    },
  });

  // useEditor only reads `editable` when it creates the editor.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  return (
    <RichTextEditor editor={editor} className={classes.caption}>
      <RichTextEditor.Content />
    </RichTextEditor>
  );
}
