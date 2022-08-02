import { Box, Button, Grid, Modal, SimpleGrid, Space, Text, TextInput, Title } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";
import { Mail, User } from "tabler-icons-react";

import { signup } from "../../actions/authActions";
import { fetchDirectoryTree, manageUpdateUser, updateUserAndScan } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";
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
  var userToEdit = props.userToEdit;
  const [newScanDirectory, setNewScanDirectory] = useState("");
  const [treeData, setTreeData] = useState([]);
  const [userName, setUserName] = useState("");
  const [userNameError, setUserNameError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userEmailError, setUserEmailError] = useState("");
  const [userFirst, setUserFirst] = useState("");
  const [userLast, setUserLast] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [newPasswordIsValid, setNewPasswordIsValid] = useState(true);

  const [isAdmin, setIsAdmin] = useState(false);
  const [scanDirectoryPlaceholder, setScanDirectoryPlaceholder] = useState("");
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const { directoryTree } = useAppSelector(state => state.util);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const [pathDoesNotExist, setPathDoesNotExist] = useState(false);
  const [pathError, setPathError] = useState("");
  const [closing, setClosing] = useState(false);

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
    if (createNew && !userToEdit) {
      userToEdit = {};
    }
    if (newScanDirectory) {
      setScanDirectoryPlaceholder(newScanDirectory);
    }
    validatePath(newScanDirectory);
    if (userToEdit) {
      if (userToEdit.scan_directory) {
        setScanDirectoryPlaceholder(userToEdit.scan_directory);
      } else {
        setScanDirectoryPlaceholder(t("modalscandirectoryedit.notset"));
      }
      setUserName(userToEdit.username);
      setUserEmail(userToEdit.email);
      setUserFirst(userToEdit.first_name);
      setUserLast(userToEdit.last_name);
      setIsAdmin(userToEdit.is_superuser == true);
    } else {
      setScanDirectoryPlaceholder(t("modalscandirectoryedit.notset"));
    }
  }, [isAdmin, closing, newScanDirectory, userToEdit, t]);

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
      setNewScanDirectory(path);
    }
  };

  const validateUsername = username => {
    var error = "";
    setUserNameError("");
    if (!username) {
      error = t("modaluseredit.errorusernamecannotbeblank");
    } else {
      userList.every(user => {
        if (user.username == username && user.id != userToEdit.id) {
          error = t("modaluseredit.errorusernameexists");
          return false;
        }
        return true;
      });
    }
    setUserNameError(error);
  };

  const validateEmail = email => {
    setUserEmailError("");

    const emailRegex = // eslint-disable-next-line no-control-regex
      /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/;

    if (email && !emailRegex.test(email)) {
      setUserEmailError(t("modaluseredit.errorinvalidemail"));
    }
  };

  const validatePath = path => {
    setPathError("");
    if (firstTimeSetup && !path) {
      setPathError(t("modalscandirectoryedit.mustspecifypath"));
      return;
    }
    if (path) {
      const result = !findPath(treeData, path);
      setPathDoesNotExist(result);
      if (result) {
        setPathError(t("modalscandirectoryedit.pathdoesnotexist"));
      }
    }
  };

  const clearStateAndClose = () => {
    setUserName("");
    setUserEmail("");
    setUserFirst("");
    setUserLast("");
    setUserPassword("");
    setNewScanDirectory("");

    setUserNameError("");
    setUserEmailError("");
    setClosing(false);
    onRequestClose();
  };

  const validateAndClose = () => {
    setClosing(true);

    validateUsername(userName);
    validateEmail(userEmail);
    validatePath(newScanDirectory);

    var newUserData = { ...userToEdit };

    if (newScanDirectory) {
      newUserData.scan_directory = newScanDirectory;
    }
    if (!newUserData.scan_directory) {
      delete newUserData.scan_directory;
    }

    if (userNameError || !newPasswordIsValid || userEmailError || pathError) {
      return;
    }
    if (createNew) {
      if (userPassword && userName) {
        signup(userName, userPassword, userEmail, userFirst, userLast, false, dispatch, true, newScanDirectory);
        clearStateAndClose();
      }
      return;
    } else {
      newUserData.email = userEmail;
      newUserData.first_name = userFirst;
      newUserData.last_name = userLast;

      if (userPassword) {
        newUserData.password = userPassword;
      }
      if (userName) {
        newUserData.username = userName;
      }
    }

    if (updateAndScan) {
      dispatch(updateUserAndScan(newUserData));
    } else {
      dispatch(manageUpdateUser(newUserData));
    }
    clearStateAndClose();
  };
  const onPasswordValidate = (pass: string, valid: boolean) => {
    setUserPassword(pass);
    setNewPasswordIsValid(valid);
  };

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
            value={userName}
            error={userNameError}
            onChange={event => {
              userToEdit.username = event.currentTarget.value;
              setUserName(userToEdit.username);
              validateUsername(event.currentTarget.value);
            }}
          />
          <TextInput
            label={t("settings.email")}
            icon={<Mail />}
            placeholder={t("settings.emailplaceholder")}
            name="email"
            value={userEmail}
            error={userEmailError}
            onChange={event => {
              userToEdit.email = event.currentTarget.value;
              setUserEmail(userToEdit.email);
              validateEmail(userToEdit.email);
            }}
          />
          <TextInput
            label={t("settings.firstname")}
            icon={<User />}
            placeholder={t("settings.firstnameplaceholder")}
            name="firstname"
            value={userFirst}
            onChange={event => {
              userToEdit.first_name = event.currentTarget.value;
              setUserFirst(userToEdit.first_name);
            }}
          />
          <TextInput
            label={t("settings.lastname")}
            icon={<User />}
            placeholder={t("settings.lastnameplaceholder")}
            name="lastname"
            value={userLast}
            onChange={event => {
              userToEdit.last_name = event.currentTarget.value;
              setUserLast(userToEdit.last_name);
            }}
          />
        </SimpleGrid>
        <PasswordEntry createNew={createNew} onValidate={onPasswordValidate} closing={closing} />
      </Box>

      <Title order={5}>{t("modalscandirectoryedit.header")} </Title>
      <Text size="sm" color="dimmed">
        {t("modalscandirectoryedit.explanation1")} &quot;{userToEdit ? userToEdit.username : "..."}&quot;{" "}
        {t("modalscandirectoryedit.explanation2")}
      </Text>
      <Space h="md" />
      <Grid grow>
        <Grid.Col span={9}>
          <TextInput
            label={t("modalscandirectoryedit.currentdirectory")}
            labelProps={{ style: { fontWeight: "bold" } }}
            ref={inputRef}
            error={pathError}
            required={firstTimeSetup}
            onChange={v => {
              setNewScanDirectory(v.currentTarget.value);
              validatePath(v.currentTarget.value);
            }}
            placeholder={scanDirectoryPlaceholder}
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
        <Button disabled={!true} onClick={() => validateAndClose()}>
          {t("save")}
        </Button>
      </div>
    </Modal>
  );
}
