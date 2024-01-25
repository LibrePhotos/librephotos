import { Box, Button, Grid, Modal, ScrollArea, SimpleGrid, Space, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconMail as Mail, IconUser as User } from "@tabler/icons-react";
import type { FormEvent } from "react";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";

import { scanPhotos } from "../../actions/photosActions";
import { useManageUpdateUserMutation, useSignUpMutation } from "../../api_client/api";
import type { DirTree } from "../../api_client/dir-tree";
import { useLazyFetchDirsQuery } from "../../api_client/dir-tree";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { IUser } from "../../store/user/user.zod";
import { EMAIL_REGEX, mergeDirTree } from "../../util/util";
import { PasswordEntry } from "../settings/PasswordEntry";

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

const findPath = (tree: DirTree[], path: string): boolean => {
  let result = false;
  tree.forEach(folder => {
    if (path === folder.absolute_path) {
      result = result || true;
    }
    if (path.startsWith(folder.absolute_path)) {
      const resultChildren = findPath(folder.children, path);
      result = result || resultChildren;
    }
    return result || false;
  });
  return result;
};

export function ModalUserEdit(props: Props) {
  const {
    isOpen,
    updateAndScan,
    selectedNodeId,
    onRequestClose: closeModal,
    userList,
    createNew,
    firstTimeSetup,
    userToEdit,
  } = props;
  const [treeData, setTreeData] = useState<DirTree[]>([]);
  const [userPassword, setUserPassword] = useState("");
  const [newPasswordIsValid, setNewPasswordIsValid] = useState(true);

  const [scanDirectoryPlaceholder, setScanDirectoryPlaceholder] = useState("");
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const [signup] = useSignUpMutation();
  const [updateUser] = useManageUpdateUserMutation();
  const [fetchDirectoryTree, { data: directoryTree }] = useLazyFetchDirsQuery();

  const validateUsername = (username: string) => {
    if (!username) {
      return t("modaluseredit.errorusernamecannotbeblank");
    }
    const exist = userList.reduce(
      (acc: boolean, user: IUser) =>
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

  const validatePath = (path: string) => {
    if (firstTimeSetup && !path) {
      return t("modalscandirectoryedit.mustspecifypath");
    }
    if (path) {
      if (!findPath(treeData, path)) {
        return t("modalscandirectoryedit.pathdoesnotexist");
      }
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
    if (auth?.access?.is_admin) {
      fetchDirectoryTree("");
    }
  }, [auth.access, dispatch]);

  useEffect(() => {
    if (!directoryTree) {
      return;
    }
    if (treeData.length === 0) {
      setTreeData(directoryTree);
    } else {
      const tree = mergeDirTree(treeData, directoryTree[0]);
      setTreeData([...tree]);
    }
  }, [directoryTree]);

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

  const nodeClicked = (event: Event, rowInfo: any) => {
    if (inputRef.current) {
      const path = rowInfo.node.absolute_path;
      inputRef.current.value = path;
      fetchDirectoryTree(path);
      form.setFieldValue("scan_directory", path);
    }
  };

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
      updateUser(newUserData).then(() => {
        if (newUserData.scan_directory) {
          dispatch(scanPhotos());
        }
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
        <Box
          sx={theme => ({
            paddingBottom: theme.spacing.md,
          })}
        >
          <SimpleGrid cols={2} spacing="xs" breakpoints={[{ maxWidth: 600, cols: 1, spacing: "sm" }]}>
            <TextInput
              required
              label={t("login.usernamelabel")}
              icon={<User />}
              placeholder={t("login.usernameplaceholder")}
              name="username"
              /* eslint-disable-next-line react/jsx-props-no-spreading */
              {...form.getInputProps("username")}
            />
            <TextInput
              label={t("settings.email")}
              icon={<Mail />}
              placeholder={t("settings.emailplaceholder")}
              name="email"
              /* eslint-disable-next-line react/jsx-props-no-spreading */
              {...form.getInputProps("email")}
            />
            <TextInput
              label={t("settings.firstname")}
              icon={<User />}
              placeholder={t("settings.firstnameplaceholder")}
              name="first_name"
              /* eslint-disable-next-line react/jsx-props-no-spreading */
              {...form.getInputProps("first_name")}
            />
            <TextInput
              label={t("settings.lastname")}
              icon={<User />}
              placeholder={t("settings.lastnameplaceholder")}
              name="last_name"
              /* eslint-disable-next-line react/jsx-props-no-spreading */
              {...form.getInputProps("last_name")}
            />
          </SimpleGrid>
          <PasswordEntry createNew={createNew} onValidate={onPasswordValidate} closing={closing} />
        </Box>
        {!createNew && (
          <>
            <Title order={5}>{t("modalscandirectoryedit.header")} </Title>
            <Text size="sm" color="dimmed">
              {t("modalscandirectoryedit.explanation1")} &quot;
              {form.values.username ? form.values.username : "\u2026"}&quot; {t("modalscandirectoryedit.explanation2")}
            </Text>
            <Space h="md" />
            <Grid grow>
              <Grid.Col span={9}>
                <TextInput
                  label={t("modalscandirectoryedit.currentdirectory")}
                  labelProps={{ style: { fontWeight: "bold" } }}
                  ref={inputRef}
                  required={firstTimeSetup}
                  placeholder={scanDirectoryPlaceholder}
                  name="scan_directory"
                  /* eslint-disable-next-line react/jsx-props-no-spreading */
                  {...form.getInputProps("scan_directory")}
                />
              </Grid.Col>
            </Grid>
            <Title order={6}>{t("modalscandirectoryedit.explanation3")}</Title>
            <div style={{ height: "150px", overflow: "auto" }}>
              <SortableTree
                innerStyle={{ outline: "none" }}
                canDrag={() => false}
                canDrop={() => false}
                treeData={treeData}
                onChange={setTreeData}
                theme={FileExplorerTheme}
                isVirtualized={false}
                generateNodeProps={(rowInfo: any) => ({
                  onClick: (event: Event) => nodeClicked(event, rowInfo),
                  className: selectedNodeId === rowInfo.node.id ? "selected-node" : undefined,
                })}
              />
            </div>
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
