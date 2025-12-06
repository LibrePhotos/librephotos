import { Box, Button, Modal, ScrollArea, SimpleGrid, Space, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconUser, IconMail as Mail } from "@tabler/icons-react";
import type { FormEvent } from "react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSignUpMutation } from "../../api_client/auth";
import { useScanPhotosMutation } from "../../api_client/jobs";
import { User } from "../../api_client/user";
import { useManageUpdateUserMutation } from "../../api_client/user/hooks";
import { EMAIL_REGEX } from "../../util/util";
import { PasswordEntry } from "../settings/PasswordEntry";
import { DirectoryPicker } from "../setup/DirectoryPicker";

type Props = Readonly<{
  isOpen: boolean;
  updateAndScan?: boolean;
  userToEdit: any;
  selectedNodeId?: string;
  onRequestClose: () => void;
  userList: any;
  createNew: boolean;
  firstTimeSetup?: boolean;
}>;

export function ModalUserEdit(props: Props) {
  const { isOpen, updateAndScan, onRequestClose: closeModal, userList, createNew, firstTimeSetup, userToEdit } = props;
  const [userPassword, setUserPassword] = useState("");
  const [newPasswordIsValid, setNewPasswordIsValid] = useState(true);
  const [scanDirectoryPlaceholder, setScanDirectoryPlaceholder] = useState("");
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const { mutate: signup } = useSignUpMutation();
  const { mutate: updateUser } = useManageUpdateUserMutation();
  const scanPhotos = useScanPhotosMutation();
  const [isPathValid, setIsPathValid] = useState(true);

  const validateUsername = (username: string) => {
    if (!username) {
      return t("modaluseredit.errorusernamecannotbeblank");
    }
    const exist = userList.reduce(
      (acc: boolean, user: User) =>
        acc || (user.id !== userToEdit.id && user.username.toLowerCase() === username.toLowerCase()),
      false
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
    },
    validate: {
      email: value => validateEmail(value),
      username: value => validateUsername(value),
      scan_directory: value => validatePath(value),
    },
  });

  useEffect(() => {
    if (userToEdit) {
      if (userToEdit.scan_directory) {
        setScanDirectoryPlaceholder(userToEdit.scan_directory);
      } else {
        setScanDirectoryPlaceholder(t("modalscandirectoryedit.notset"));
      }
      form.setValues({
        username: userToEdit.username,
        email: userToEdit.email,
        first_name: userToEdit.first_name,
        last_name: userToEdit.last_name,
        scan_directory: userToEdit.scan_directory,
        password: userPassword || "",
      });
    } else {
      setScanDirectoryPlaceholder(t("modalscandirectoryedit.notset"));
    }
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
    const newUserData = { ...userToEdit };

    if (scanDirectory) {
      newUserData.scan_directory = scanDirectory;
    }
    if (!newUserData.scan_directory) {
      delete newUserData.scan_directory;
    }

    if (createNew) {
      if (userPassword && username) {
        signup({
          username: username.toLowerCase(),
          password: userPassword,
          email,
          first_name: firstName,
          last_name: lastName,
        });
        closeModal();
      }
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

    if (updateAndScan) {
      updateUser(newUserData, {
        onSuccess: () => {
          if (newUserData.scan_directory) {
            scanPhotos.mutate();
          }
        },
      });
    } else {
      updateUser(newUserData);
    }
    closeModal();
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

  return (
    <Modal
      opened={isOpen}
      centered
      scrollAreaComponent={ScrollArea.Autosize}
      size="xl"
      onClose={() => {
        closeModal();
      }}
      title={<Title order={4}>{createNew ? t("modaluseredit.createheader") : t("modaluseredit.header")}</Title>}
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
              description={<Title order={6}>{t("modalscandirectoryedit.explanation3")}</Title>}
              missingPathError={t("modalscandirectoryedit.pathdoesnotexist")}
            />
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="default" onClick={() => closeModal()}>
            {t("cancel")}
          </Button>
          <Space w="md" />
          <Button type="submit">{t("save")}</Button>
        </div>
      </form>
    </Modal>
  );
}

ModalUserEdit.defaultProps = {
  updateAndScan: false,
  selectedNodeId: "",
  firstTimeSetup: false,
};
