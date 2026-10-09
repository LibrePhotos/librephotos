import type { ModalProps } from "@mantine/core";

/**
 * Mantine renders a modal's title inside its own <h2>. A <Title> passed as the
 * title nested a heading in a heading (invalid HTML, React warnings), and each
 * modal picked its own size, from 16px to 34px. Dialogs pass plain text and
 * share this one style instead. App.tsx sets it as the Modal theme default, so
 * every modal gets it; the dialogs here also pass it so they keep the look when
 * rendered without the app theme.
 */
export const modalTitleStyles: ModalProps["styles"] = {
  title: { fontSize: "var(--mantine-font-size-lg)", fontWeight: 700 },
};
