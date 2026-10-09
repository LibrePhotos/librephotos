import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import React, { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

/** The suggestion props the list uses; the renderer hands it all of them. */
export type MentionListProps = {
  items: string[];
  command: (attrs: MentionNodeAttrs) => void;
};

/** What the suggestion plugin calls on the list while it is open. */
export type MentionListHandle = {
  onKeyDown: (props: Pick<SuggestionKeyDownProps, "event">) => boolean;
};

export const MentionList = forwardRef<MentionListHandle, MentionListProps>((props, ref) => {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];

    if (item) {
      props.command({ id: item });
    }
  };

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
  };

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length);
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

  useEffect(() => setSelectedIndex(0), [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        upHandler();
        return true;
      }

      if (event.key === "ArrowDown") {
        downHandler();
        return true;
      }

      if (event.key === "Enter") {
        enterHandler();
        return true;
      }

      return false;
    },
  }));

  return (
    // tippy mounts this on document.body, outside the Mantine tree, but the theme's
    // CSS variables are global, so it can still follow the colour scheme.
    <div
      style={{
        padding: "0.2rem",
        position: "relative",
        borderRadius: "var(--mantine-radius-md)",
        background: "var(--mantine-color-body)",
        color: "var(--mantine-color-text)",
        border: "1px solid var(--mantine-color-default-border)",
        boxShadow: "var(--mantine-shadow-md)",
        overflow: "hidden",
        fontSize: "var(--mantine-font-size-sm)",
      }}
    >
      {props.items.length ? (
        props.items.map((item, index) => (
          <button
            type="button"
            style={{
              display: "block",
              margin: "0",
              padding: "0.2rem 0.5rem",
              width: "100%",
              textAlign: "left",
              border: 0,
              borderRadius: "var(--mantine-radius-sm)",
              cursor: "pointer",
              // Buttons do not inherit colour or font; in dark mode they would
              // keep the browser's own ButtonText on our background.
              font: "inherit",
              color: index === selectedIndex ? "var(--mantine-primary-color-light-color)" : "inherit",
              background: index === selectedIndex ? "var(--mantine-primary-color-light)" : "transparent",
            }}
            key={item}
            onClick={() => selectItem(index)}
          >
            {item}
          </button>
        ))
      ) : (
        <div style={{ padding: "0.2rem 0.5rem", color: "var(--mantine-color-dimmed)" }}>
          {t("lightbox.sidebar.noMentionResults")}
        </div>
      )}
    </div>
  );
});
