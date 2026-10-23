import type { ListUser, User } from "@librephotos/api-client";
import { Box, Button, Group, Modal, ScrollArea, SimpleGrid, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { IconUser, IconMail as Mail } from "@tabler/icons-react";
import React, { useEffect, useEffectEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSignUpMutation } from "../../api_client/auth";
import { useScanPhotosMutation } from "../../api_client/jobs";
import { useGetSettingsQuery } from "../../api_client/settings";
import { useManageUpdateUserMutation } from "../../api_client/user/hooks";
import { notification } from "../../service/notifications";
import { reportUserSaveError } from "../../util/apiErrors";
import { PasswordEntry } from "../settings/PasswordEntry";
import { modalTitleStyles } from "./modalTitleStyles";
import { makeUserEditSchema, type UserEditValues } from "./ModalUserEdit.schema";
import { photosToTrash } from "./photosToTrash";
import { UserFoldersSection } from "./UserFoldersSection";
import { useScanDirectoryChange } from "./useScanDirectoryChange";

type Props = Readonly<{
  isOpen: boolean;
  updateAndScan?: boolean;
  /** The user to edit; "Add new user" passes {}. */
  userToEdit: Readonly<Partial<User>>;
  selectedNodeId?: string;
  onRequestClose: () => void;
  /** The users a new username must not clash with; none while the list is loading. */
  userList?: readonly Pick<ListUser, "id" | "username">[];
  createNew: boolean;
  firstTimeSetup?: boolean;
}>;

const EMPTY_VALUES: UserEditValues = {
  username: "",
  email: "",
  first_name: "",
  last_name: "",
  password: "",
  passwordConfirm: "",
  changePassword: false,
  scan_directory: "",
  upload_directory: "",
  photos_outside: "keep",
};

export function ModalUserEdit(props: Props) {
  const {
    isOpen,
    updateAndScan,
    onRequestClose: closeModal,
    userList = [],
    createNew,
    firstTimeSetup,
    userToEdit,
  } = props;
  const [scanDirectoryPlaceholder, setScanDirectoryPlaceholder] = useState("");
  const { t } = useTranslation();
  const { mutate: signup, isPending: isSigningUp } = useSignUpMutation({ reportsErrors: true });
  const { mutate: updateUser, isPending: isUpdating } = useManageUpdateUserMutation({ reportsErrors: true });
  const scanPhotos = useScanPhotosMutation();
  const { data: siteSettings } = useGetSettingsQuery();
  // The upload folder only matters while uploads are allowed on this server.
  const uploadsAllowed = !!siteSettings?.allow_upload;
  const [isPathValid, setIsPathValid] = useState(true);
  const [isUploadPathValid, setIsUploadPathValid] = useState(true);
  const isSaving = createNew ? isSigningUp : isUpdating;
  // A library folder dialog above this one keeps Escape for itself (#123).
  const [folderDialogOpened, folderDialog] = useDisclosure(false);

  const form = useForm({
    initialValues: EMPTY_VALUES,
    validate: schemaResolver(
      makeUserEditSchema(t, {
        otherUsernames: userList.filter(user => user.id !== userToEdit.id).map(user => user.username),
        createNew,
        firstTimeSetup: !!firstTimeSetup,
        isPathValid,
        isUploadPathValid,
      }),
      { sync: true }
    ),
  });

  // Reads the form at reset time; it is not a trigger (see below).
  const resetFromUser = useEffectEvent((user: Readonly<Partial<User>>) => {
    if (user) {
      if (user.scan_directory) {
        setScanDirectoryPlaceholder(user.scan_directory);
      } else {
        setScanDirectoryPlaceholder(t("modalscandirectoryedit.notset"));
      }
      // Every field falls back to "": "Add new user" passes {}, and an
      // undefined value turned the inputs uncontrolled, so they kept showing
      // the last edited user while the form itself was empty.
      form.setValues({
        username: user.username ?? "",
        email: user.email ?? "",
        first_name: user.first_name ?? "",
        last_name: user.last_name ?? "",
        scan_directory: user.scan_directory ?? "",
        upload_directory: user.upload_directory ?? "",
        // Another user starts with the password fields locked and empty.
        password: "",
        passwordConfirm: "",
        changePassword: false,
        // A changed scan directory keeps the photos outside it unless the admin says otherwise.
        photos_outside: "keep",
      });
    } else {
      setScanDirectoryPlaceholder(t("modalscandirectoryedit.notset"));
    }
  });
  // Reset the form only when a different user is opened (or the language changes, for the
  // placeholder). `form` is a new object every render; as a trigger it would wipe the fields the
  // admin is editing.
  useEffect(() => {
    resetFromUser(userToEdit);
  }, [userToEdit, t]);

  const change = useScanDirectoryChange({
    userId: createNew ? undefined : userToEdit.id,
    savedScanDirectory: userToEdit.scan_directory ?? undefined,
    scanDirectory: form.values.scan_directory,
    uploadDirectory: form.values.upload_directory,
    isPathValid,
  });
  const trashCount = photosToTrash(change, form.values.photos_outside);

  useEffect(() => {
    if (form.values.scan_directory) {
      setScanDirectoryPlaceholder(form.values.scan_directory);
    }
  }, [form.values.scan_directory]);

  const validateAndClose = () => {
    const { email, username, first_name: firstName, last_name: lastName, scan_directory: scanDirectory } = form.values;
    // Locked fields hold no password (locking empties them); the schema checked unlocked ones.
    const password = createNew || form.values.changePassword ? form.values.password : "";
    const newUserData: Partial<User> = { ...userToEdit };

    if (scanDirectory) {
      newUserData.scan_directory = scanDirectory;
    }
    if (!newUserData.scan_directory) {
      delete newUserData.scan_directory;
    }
    // Sent only when the admin changed it ("" restores the default). A caller
    // that never loaded the stored folder would otherwise reset it on every
    // save of the user.
    const uploadDirectory = form.values.upload_directory ?? "";
    if (uploadDirectory !== (userToEdit.upload_directory ?? "")) {
      newUserData.upload_directory = uploadDirectory;
    } else {
      delete newUserData.upload_directory;
    }

    if (createNew) {
      if (password && username) {
        signup(
          {
            username: username.toLowerCase(),
            password,
            email,
            first_name: firstName,
            last_name: lastName,
          },
          { onSuccess: () => closeModal(), onError: reportUserSaveError }
        );
      }
      return;
    }
    // Only an existing user is edited, and every one has an id. Without one (the
    // dialog opened before the user's details loaded) there is nothing to save to:
    // say so, as the request to /manage/user/undefined/ used to by failing.
    const { id } = userToEdit;
    if (id === undefined) {
      notification.updateUserError();
      return;
    }
    newUserData.email = email;
    newUserData.first_name = firstName;
    newUserData.last_name = lastName;

    if (password) {
      newUserData.password = password;
    }
    if (username) {
      newUserData.username = username;
    }

    // The modal must stay open when the backend rejects the save (for example
    // a scan directory outside the data root), otherwise the failure is
    // invisible and the old value silently stays in place. See issue #492.
    updateUser(
      { ...newUserData, id },
      {
        onSuccess: () => {
          if (trashCount) {
            change.trashOutside(username || (userToEdit.username ?? ""), trashCount);
          }
          if (updateAndScan && newUserData.scan_directory) {
            scanPhotos.mutate();
          }
          closeModal();
        },
        onError: reportUserSaveError,
      }
    );
  };

  return (
    <Modal
      styles={modalTitleStyles}
      opened={isOpen}
      centered
      scrollAreaComponent={ScrollArea.Autosize}
      size="xl"
      closeOnEscape={!folderDialogOpened}
      onClose={() => {
        closeModal();
      }}
      title={createNew ? t("modaluseredit.createheader") : t("modaluseredit.header")}
    >
      <form onSubmit={form.onSubmit(validateAndClose)}>
        <Box pb="md">
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
            <TextInput
              required
              label={t("login.usernamelabel")}
              leftSection={<IconUser />}
              placeholder={t("login.usernameplaceholder")}
              name="username"
              {...form.getInputProps("username")}
            />
            <TextInput
              label={t("settings.email")}
              leftSection={<Mail />}
              placeholder={t("settings.emailplaceholder")}
              name="email"
              {...form.getInputProps("email")}
            />
            <TextInput
              label={t("settings.firstname")}
              leftSection={<IconUser />}
              placeholder={t("settings.firstnameplaceholder")}
              name="first_name"
              {...form.getInputProps("first_name")}
            />
            <TextInput
              label={t("settings.lastname")}
              leftSection={<IconUser />}
              placeholder={t("settings.lastnameplaceholder")}
              name="last_name"
              {...form.getInputProps("last_name")}
            />
          </SimpleGrid>

          <Box mt="sm">
            <PasswordEntry form={form} createNew={createNew} />
          </Box>
        </Box>
        {!createNew && (
          <UserFoldersSection
            form={form}
            firstTimeSetup={!!firstTimeSetup}
            uploadsAllowed={uploadsAllowed}
            scanDirectoryPlaceholder={scanDirectoryPlaceholder}
            isPathValid={isPathValid}
            isUploadPathValid={isUploadPathValid}
            onPathValidity={setIsPathValid}
            onUploadPathValidity={setIsUploadPathValid}
            change={change}
            libraryOwner={
              userToEdit.id !== undefined && userToEdit.scan_directory
                ? { id: userToEdit.id, username: userToEdit.username ?? "" }
                : undefined
            }
            onFolderDialogChange={opened => (opened ? folderDialog.open() : folderDialog.close())}
          />
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => closeModal()}>
            {t("cancel")}
          </Button>
          {/* Red, and saying so, when Save also moves photos to the trash (#2036). */}
          <Button type="submit" loading={isSaving} disabled={isSaving} color={trashCount ? "red" : undefined}>
            {trashCount ? t("modaluseredit.saveandtrash", { count: trashCount }) : t("save")}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
