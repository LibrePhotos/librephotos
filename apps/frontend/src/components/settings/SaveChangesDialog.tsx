import { Button, Dialog, Group, Text, useMatches } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { FOOTER_HEIGHT } from "../../uiConstants";
import { LeaveWithoutSavingModal } from "./LeaveWithoutSavingModal";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

type SaveChangesDialogProps = Readonly<{
  opened: boolean;
  saving?: boolean;
  onSave: () => void;
  /** Called by Cancel and by the close button: both discard the pending edits. */
  onCancel: () => void;
}>;

/**
 * The floating "Save changes?" prompt the Settings, Profile and Library pages show while they
 * hold unsaved edits. The close button discards like Cancel does: a dialog closed any other way
 * would leave the edits on screen with no way left to save them.
 *
 * While it is open, leaving the page asks first (#2224): a link opens "Leave without saving?",
 * closing the tab the browser's own dialog.
 */
export function SaveChangesDialog({ opened, saving = false, onSave, onCancel }: SaveChangesDialogProps) {
  const { t } = useTranslation();
  // Below `sm` the AppShell has a bottom navigation bar; keep the dialog above it.
  const bottom = useMatches({ base: FOOTER_HEIGHT + 16, sm: 30 });
  const blocker = useUnsavedChangesGuard(opened);

  return (
    <>
      <LeaveWithoutSavingModal
        opened={blocker.status === "blocked"}
        onClose={() => blocker.reset?.()}
        onLeave={() => blocker.proceed?.()}
      />
      <Dialog
        opened={opened}
        // Hidden while saving, like Cancel is disabled: discarding then would leave a failed save
        // reporting edits that are no longer on screen.
        withCloseButton={!saving}
        onClose={onCancel}
        size="lg"
        radius="md"
        position={{ bottom, right: 30 }}
        data-testid="save-changes-dialog"
      >
        <Text size="sm" mb={10} fw={500}>
          {t("settings.savechanges")}
        </Text>

        <Group justify="flex-end">
          <Button size="sm" variant="default" onClick={onCancel} disabled={saving}>
            {t("settings.nextcloudcancel")}
          </Button>
          <Button size="sm" onClick={onSave} loading={saving}>
            {t("settings.favoriteupdate")}
          </Button>
        </Group>
      </Dialog>
    </>
  );
}
