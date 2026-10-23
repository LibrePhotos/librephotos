import { useDisclosure } from "@mantine/hooks";

type Disclosure = Readonly<{ opened: boolean; open: () => void; close: () => void }>;

/** The open state of the dialogs that edit a selection (`SelectionEditItems` opens them). */
export type SelectionEditDialogState = Readonly<{
  dateTime: Disclosure;
  location: Disclosure;
  move: Disclosure;
  rename: Disclosure;
}>;

function useDialog(): Disclosure {
  const [opened, { open, close }] = useDisclosure(false);
  return { opened, open, close };
}

/**
 * Change date and time (#2278), Set location (#2279), Move to folder (#352) and Rename files (#2773),
 * each closed at first.
 */
export function useSelectionEditDialogs(): SelectionEditDialogState {
  return { dateTime: useDialog(), location: useDialog(), move: useDialog(), rename: useDialog() };
}
