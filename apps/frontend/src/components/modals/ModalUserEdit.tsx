import { Box, Button, Group, Modal, ScrollArea, SimpleGrid, Space, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconUser, IconMail as Mail } from "@tabler/icons-react";
import type { FormEvent } from "react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSignUpMutation } from "../../api_client/auth";
import { useScanPhotosMutation } from "../../api_client/jobs";
import { useGetSettingsQuery } from "../../api_client/settings";
import type { ListUser, User } from "../../api_client/user";
import { useManageUpdateUserMutation } from "../../api_client/user/hooks";
import { notification } from "../../service/notifications";
import { reportUserSaveError } from "../../util/apiErrors";
import { EMAIL_REGEX } from "../../util/util";
import { PasswordEntry } from "../settings/PasswordEntry";
import { DirectoryPicker } from "../setup/DirectoryPicker";
import { uploadLocation } from "../setup/uploadLocation";
import { modalTitleStyles } from "./modalTitleStyles";

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
  const [userPassword, setUserPassword] = useState("");
  const [newPasswordIsValid, setNewPasswordIsValid] = useState(true);
  const [scanDirectoryPlaceholder, setScanDirectoryPlaceholder] = useState("");
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const { mutate: signup, isPending: isSigningUp } = useSignUpMutation();
  const { mutate: updateUser, isPending: isUpdating } = useManageUpdateUserMutation();
  const scanPhotos = useScanPhotosMutation();
  const { data: siteSettings } = useGetSettingsQuery();
  // The upload folder only matters while uploads are allowed on this server.
  const uploadsAllowed = !!siteSettings?.allow_upload;
  const [isPathValid, setIsPathValid] = useState(true);
  const [isUploadPathValid, setIsUploadPathValid] = useState(true);
  const isSaving = createNew ? isSigningUp : isUpdating;

  const validateUsername = (username: string) => {
    if (!username) {
      return t("modaluseredit.errorusernamecannotbeblank");
    }
    const exist = userList.some(
      user => user.id !== userToEdit.id && user.username.toLowerCase() === username.toLowerCase()
    );
    if (exist) {
      return t("modaluseredit.errorusernameexists");
    }
    return null;
  };

  const validateEmail = (email: string) => {
    if (email && !EMAIL_REGEX.test(email)) {
      return t("modaluseredit.errorinvalidemail");
    }
    return null;
  };

  const validatePath = (scanDirectory: string) => {
    if (firstTimeSetup && !scanDirectory) {
      return t("modalscandirectoryedit.mustspecifypath");
    }
    if (scanDirectory && !isPathValid) {
      return t("modalscandirectoryedit.pathdoesnotexist");
    }
    return null;
  };

  const form = useForm({
    initialValues: {
      username: "",
      email: "",
      first_name: "",
      last_name: "",
      password: "",
      scan_directory: "",
      upload_directory: "",
    },
    validate: {
      email: value => validateEmail(value),
      username: value => validateUsername(value),
      scan_directory: value => validatePath(value),
      upload_directory: value => (value && !isUploadPathValid ? t("modalscandirectoryedit.pathdoesnotexist") : null),
    },
  });

  useEffect(() => {
    if (userToEdit) {
      if (userToEdit.scan_directory) {
        setScanDirectoryPlaceholder(userToEdit.scan_directory);
      } else {
        setScanDirectoryPlaceholder(t("modalscandirectoryedit.notset"));
      }
      // Every field falls back to "": "Add new user" passes {}, and an
      // undefined value turned the inputs uncontrolled, so they kept showing
      // the last edited user while the form itself was empty.
      form.setValues({
        username: userToEdit.username ?? "",
        email: userToEdit.email ?? "",
        first_name: userToEdit.first_name ?? "",
        last_name: userToEdit.last_name ?? "",
        scan_directory: userToEdit.scan_directory ?? "",
        upload_directory: userToEdit.upload_directory ?? "",
        password: userPassword || "",
      });
    } else {
      setScanDirectoryPlaceholder(t("modalscandirectoryedit.notset"));
    }
    // Reset the form only when a different user is opened. `form` is a new object
    // every render and `userPassword` changes while typing; either would wipe the
    // fields the admin is editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userToEdit, t]);

  useEffect(() => {
    if (form.values.scan_directory) {
      setScanDirectoryPlaceholder(form.values.scan_directory);
    }
  }, [form.values.scan_directory]);

  const validateAndClose = () => {
    setClosing(true);

    if (!newPasswordIsValid) {
      return;
    }
    const { email, username, first_name: firstName, last_name: lastName, scan_directory: scanDirectory } = form.values;
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
      if (userPassword && username) {
        signup(
          {
            username: username.toLowerCase(),
            password: userPassword,
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

    if (userPassword) {
      newUserData.password = userPassword;
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
          if (updateAndScan && newUserData.scan_directory) {
            scanPhotos.mutate();
          }
          closeModal();
        },
        onError: reportUserSaveError,
      }
    );
  };

  const onPasswordValidate = (pass: string, valid: boolean) => {
    setUserPassword(pass);
    setNewPasswordIsValid(valid);
  };

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = form.validate();
    if (!result.hasErrors) {
      validateAndClose();
    }
  }

  // Null without a scan directory: the backend refuses uploads then.
  const webUploadLocation = uploadLocation(form.values.scan_directory, form.values.upload_directory);

  return (
    <Modal
      styles={modalTitleStyles}
      opened={isOpen}
      centered
      scrollAreaComponent={ScrollArea.Autosize}
      size="xl"
      onClose={() => {
        closeModal();
      }}
      title={createNew ? t("modaluseredit.createheader") : t("modaluseredit.header")}
    >
      <form onSubmit={onSubmit}>
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
            <PasswordEntry createNew={createNew} onValidate={onPasswordValidate} closing={closing} />
          </Box>
        </Box>
        {!createNew && (
          <>
            <Title order={5}>{t("modalscandirectoryedit.header")} </Title>
            <Text size="sm" c="dimmed">
              {t("modalscandirectoryedit.explanation1")} &quot;
              {form.values.username ? form.values.username : "\u2026"}&quot; {t("modalscandirectoryedit.explanation2")}
            </Text>
            <Space h="md" />
            <DirectoryPicker
              value={form.values.scan_directory}
              onChange={next => form.setFieldValue("scan_directory", next)}
              onValidityChange={setIsPathValid}
              required={firstTimeSetup}
              placeholder={scanDirectoryPlaceholder}
              label={
                <Text fw="bold" span>
                  {t("modalscandirectoryedit.currentdirectory")}
                </Text>
              }
              description={
                <Text size="sm" c="dimmed" mt="xs">
                  {t("modalscandirectoryedit.explanation3")}
                </Text>
              }
              missingPathError={t("modalscandirectoryedit.pathdoesnotexist")}
            />
            {uploadsAllowed && (
              <>
                <Space h="md" />
                <DirectoryPicker
                  name="upload_directory"
                  value={form.values.upload_directory}
                  onChange={next => form.setFieldValue("upload_directory", next)}
                  onValidityChange={setIsUploadPathValid}
                  placeholder={t("modalscandirectoryedit.uploadfolderdefault")}
                  label={
                    <Text fw="bold" span>
                      {t("modalscandirectoryedit.uploadfolder")}
                    </Text>
                  }
                  // Under the upload folder input, the one that changes it, rather than
                  // two fields up; a missing folder would make the announced location wrong.
                  hint={
                    isPathValid && isUploadPathValid && webUploadLocation ? (
                      <Text size="sm" c="dimmed" mt={4} style={{ overflowWrap: "anywhere" }}>
                        {t("modalscandirectoryedit.uploadlocation", { path: webUploadLocation })}
                      </Text>
                    ) : undefined
                  }
                  description={
                    <Text size="sm" c="dimmed" mt="xs">
                      {t("modalscandirectoryedit.uploadfolderexplanation")}
                    </Text>
                  }
                  missingPathError={t("modalscandirectoryedit.pathdoesnotexist")}
                />
              </>
            )}
          </>
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => closeModal()}>
            {t("cancel")}
          </Button>
          <Button type="submit" loading={isSaving} disabled={isSaving}>
            {t("save")}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
