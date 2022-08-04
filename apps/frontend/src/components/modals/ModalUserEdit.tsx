import { Box, Button, Grid, Modal, SimpleGrid, Space, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import React, { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";
import { Mail, User } from "tabler-icons-react";

import { scanPhotos } from "../../actions/photosActions";
import { fetchDirectoryTree, updateUserAndScan } from "../../actions/utilActions";
import { useManageUpdateUserMutation, useSignUpMutation } from "../../api_client/api";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { EMAIL_REGEX } from "../../util/util";
import { PasswordEntry } from "../settings/PasswordEntry";

type Props = {
  isOpen: boolean;
  updateAndScan?: boolean;
  userToEdit: any;
  selectedNodeId?: string;
  onRequestClose: () => void;
  userList: any;
  createNew: boolean;
  firstTimeSetup?: boolean;
};

export function ModalUserEdit(props: Props) {
  const { isOpen, updateAndScan, selectedNodeId, onRequestClose, userList, createNew, firstTimeSetup } = props;
  const userToEdit = props.userToEdit;
  const [treeData, setTreeData] = useState([]);
  const [userPassword, setUserPassword] = useState("");
  const [newPasswordIsValid, setNewPasswordIsValid] = useState(true);

  const [scanDirectoryPlaceholder, setScanDirectoryPlaceholder] = useState("");
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const { directoryTree } = useAppSelector(state => state.util);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const [signup] = useSignUpMutation();
  const [updateUser] = useManageUpdateUserMutation();

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
    if (auth.access && auth.access.is_admin) {
      dispatch(fetchDirectoryTree(""));
    }
  }, [auth.access, dispatch]);

  useEffect(() => {
    if (treeData.length === 0) {
      setTreeData(directoryTree);
    } else {
      const newData = replacePath(treeData, directoryTree[0]);

      // @ts-ignore
      setTreeData([...newData]);
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
        password: userPassword ? userPassword : "",
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

  const findPath = (treeData, path) => {
    var result = false;
    treeData.forEach(folder => {
      if (path === folder.absolute_path) {
        result = result || true;
      }
      if (path.startsWith(folder.absolute_path)) {
        const resultChildren = findPath(folder.children, path);
        result = result || resultChildren;
      }
      return (result = result || false);
    });
    return result;
  };

  const replacePath = (treeData, newData) => {
    const path = newData.absolute_path;
    treeData.map(folder => {
      if (path === folder.absolute_path) {
        folder.children = newData.children;
        return folder;
      }
      if (path.startsWith(folder.absolute_path)) {
        const newTreeData = replacePath(folder.children, newData);
        folder.children = newTreeData;
        return folder;
      }
      return folder;
    });
    return treeData;
  };

  const nodeClicked = (event, rowInfo) => {
    if (inputRef.current) {
      const path = rowInfo.node.absolute_path;
      inputRef.current.value = path;
      dispatch(fetchDirectoryTree(path));
      form.setFieldValue("scan_directory", path);
    }
  };

  const validateUsername = username => {
    var error = null;
    if (!username) {
      error = t("modaluseredit.errorusernamecannotbeblank");
    } else if (userList && userList.results) {
      userList.results.every(user => {
        if (user.username.toLowerCase() == username.toLowerCase() && user.id != userToEdit.id) {
          error = t("modaluseredit.errorusernameexists");
          return false;
        }
        return true;
      });
    }
    return error;
  };

  const validateEmail = email => {
    if (email && !EMAIL_REGEX.test(email)) {
      return t("modaluseredit.errorinvalidemail");
    }
    return null;
  };

  const validatePath = path => {
    if (firstTimeSetup && !path) {
      return t("modalscandirectoryedit.mustspecifypath");
    }
    if (path) {
      const result = !findPath(treeData, path);
      if (result) {
        return t("modalscandirectoryedit.pathdoesnotexist");
      }
    }
    return null;
  };

  const clearStateAndClose = () => {
    onRequestClose();
  };

  const validateAndClose = () => {
    setClosing(true);

    if (!newPasswordIsValid) {
      return;
    }
    var { email, username, first_name, last_name, scan_directory } = form.values;
    username = username.toLowerCase();
    var newUserData = { ...userToEdit };

    if (scan_directory) {
      newUserData.scan_directory = scan_directory;
    }
    if (!newUserData.scan_directory) {
      delete newUserData.scan_directory;
    }

    if (createNew) {
      if (userPassword && username) {
        signup({
          username: username,
          password: userPassword,
          email: email,
          is_superuser: false,
          first_name: first_name,
          last_name: last_name,
          scan_directory: scan_directory ? scan_directory : "initial",
        });
        clearStateAndClose();
      }
      return;
    } else {
      newUserData.email = email;
      newUserData.first_name = first_name;
      newUserData.last_name = last_name;

      if (userPassword) {
        newUserData.password = userPassword;
      }
      if (username) {
        newUserData.username = username;
      }
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
    clearStateAndClose();
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
      overflow="outside"
      size="xl"
      onClose={() => {
        clearStateAndClose();
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
            onChange={changedTreeData => setTreeData(changedTreeData)}
            theme={FileExplorerTheme}
            isVirtualized={false}
            generateNodeProps={rowInfo => {
              const nodeProps = {
                onClick: event => nodeClicked(event, rowInfo),
              };
              if (selectedNodeId === rowInfo.node.id) {
                // @ts-ignore
                nodeProps.className = "selected-node";
              }
              return nodeProps;
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="default" onClick={() => clearStateAndClose()}>
            {t("cancel")}
          </Button>
          <Space w="md" />
          <Button disabled={!true} type="submit">
            {t("save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
