import { Alert, Box, Button, Grid, Modal, PasswordInput, Space, Stack, Text, TextInput, Title } from "@mantine/core";
import React, { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";
import { User, Mail, Lock, InfoCircle, Edit } from "tabler-icons-react";
import { signup } from "../../actions/authActions";

import { fetchDirectoryTree, manageUpdateUser, updateUserAndScan } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = {
  isOpen: boolean;
  updateAndScan?: boolean;
  userToEdit: any;
  selectedNodeId?: string;
  onRequestClose: () => void;
  userList: any;
  createNew: boolean;
};

export function ModalUserEdit(props: Props) {
  const { isOpen, updateAndScan, selectedNodeId, onRequestClose, userList, createNew } = props;
  var userToEdit = props.userToEdit;
  const [newScanDirectory, setNewScanDirectory] = useState("");
  const [treeData, setTreeData] = useState([]);
  const [userName, setUserName] = useState("");
  const [userNameError, setUserNameError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userFirst, setUserFirst] = useState("");
  const [userLast, setUserLast] = useState("");
  const [userPassword, setUserPassword] = useState("");
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [scanDirectoryPlaceholder, setScanDirectoryPlaceholder] = useState("");
  const [editPasswordMode, setEditPasswordMode] = useState(false);
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const { directoryTree } = useAppSelector(state => state.util);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const [pathDoesNotExist, setPathDoesNotExist] = useState(false);
  const [newPasswordIsValid, setNewPasswordIsValid] = useState(true); 
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");

  const isNotValidPath =
    !userToEdit || pathDoesNotExist || userToEdit.scan_directory === newScanDirectory || newScanDirectory === "";

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
    if (createNew) {
      userToEdit = {};
    }
    if (newScanDirectory) {
      setScanDirectoryPlaceholder(newScanDirectory);
      return;
    }
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
  }, [isAdmin, newScanDirectory, userToEdit, t]);

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

  const validateUsername = (username) => {
    var error = "";
    setUserNameError("");
    if (!username) {
      error = "User name cannot be blank";
    } else {
      userList.forEach(user => {
        if (user.username == username && user.id != userToEdit.id) {
          error = "A user with that name already exists";
        }
      });
    }
    setUserNameError(error);
  }

  const validateAndUpdatePassword = (password, passwordConfirm) => {
    if (password && passwordConfirm) {
      if (password == passwordConfirm) {
        setNewPasswordIsValid(true);
        setUserPassword(password);
      } else {
        setNewPasswordIsValid(false);
        setUserPassword("");
      }
    } else {
      setNewPasswordIsValid(true);
      setUserPassword("");
    }
  };
  return (
    <Modal
      opened={isOpen}
      centered
      overflow="outside"
      size="xl"
      onClose={() => {
        if (createNew) {
          if (userPassword != "" && userName != "") {
            signup(userName, userPassword, userEmail, userFirst, userLast, false, dispatch, true);
          }
        } else { 
          var scan_directory = newScanDirectory;
          if (scan_directory === "") {
            scan_directory = userToEdit.scan_directory;
          }
          var newUserData = {
            ...userToEdit,
            scan_directory: scan_directory,
            email: userEmail,
            first_name: userFirst,
            last_name: userLast,
          };
          if (userPassword != "") {
            newUserData.password = userPassword;
          }
          if (userName != "") {
            newUserData.username = userName;
          };
          
          dispatch(manageUpdateUser(newUserData));
        }
        onRequestClose();
        setNewPassword("");
        setNewPasswordConfirm("");
        setUserPassword("");
        setEditPasswordMode(false);
        setUserNameError("");
      }}
      title={
        <Title order={4}>{createNew ? "Create Uuser" : t("modaluseredit.header")}</Title>
      }
    >
      <Box sx={(theme) => ({
          paddingBottom: theme.spacing.md
        })}>
        <Stack spacing="xs">
          {isAdmin ?  
            <Alert variant="outline" icon={<InfoCircle size={16}/>} color="gray">
              You cannot edit the admin user name.
            </Alert>: ""}
          <TextInput
            required
            icon={<User />}
            disabled={isAdmin}
            placeholder={t("login.usernameplaceholder")}
            name="username"
            value={userName}
            error={userNameError}
            onChange={(event) => {
              userToEdit.username = event.currentTarget.value;
              setUserName(userToEdit.username);
              validateUsername(event.currentTarget.value);
            }}
          />
          <TextInput
            required
            icon={<Mail />}
            placeholder={t("settings.emailplaceholder")}
            name="email"
            value={userEmail}
            onChange={(event) => {
              userToEdit.email = event.currentTarget.value;
              setUserEmail(userToEdit.email);
            }}
          />
          <TextInput
            required
            icon={<User />}
            placeholder={t("settings.firstnameplaceholder")}
            name="firstname"
            value={userFirst}
            onChange={(event) => {
              userToEdit.first_name = event.currentTarget.value;
              setUserFirst(userToEdit.first_name);
            }}
          />
          <TextInput
            required
            icon={<User />}
            placeholder={t("settings.lastnameplaceholder")}
            name="lastname"
            value={userLast}
            onChange={(event) => {
              userToEdit.last_name = event.currentTarget.value;
              setUserLast(userToEdit.last_name);
            }}
          />
          {
          createNew ? "" : 
          <Title order={5}>
            Change Password
            <Button variant="subtle"
              leftIcon={<Edit size={16} />}
              title="Change password"
              onClick={() => setEditPasswordMode(!editPasswordMode)}
            />
          </Title>
          }
          
          <PasswordInput
            icon={<Lock />}
            placeholder={t("login.passwordplaceholder")}
            name="password"
            disabled={!editPasswordMode && !createNew}
            required={editPasswordMode}
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.currentTarget.value);
              validateAndUpdatePassword(event.currentTarget.value, newPasswordConfirm);
            }}
          />
          <PasswordInput
            icon={<Lock />}
            placeholder={t("login.confirmpasswordplaceholder")}
            name="passwordConfirm"
            disabled={!editPasswordMode && !createNew}
            required={editPasswordMode}
            value={newPasswordConfirm}
            error={ !newPasswordIsValid && editPasswordMode ? "Passwords must match": ""}
            onChange={(event) => {
              setNewPasswordConfirm(event.currentTarget.value);
              validateAndUpdatePassword(newPassword, event.currentTarget.value);
            }}
          />
        </Stack>
      </Box>

      <Title order={5}>{t("modalscandirectoryedit.header")} </Title>
      <Text size="sm" color="dimmed">
        {t("modalscandirectoryedit.explanation1")} &quot;{userToEdit ? userToEdit.username : "..."}&quot;{" "}
        {t("modalscandirectoryedit.explanation2")}
      </Text>
      <Space h="md" />
      <Title order={6}>{t("modalscandirectoryedit.currentdirectory")} </Title>
      <Grid grow>
        <Grid.Col span={9}>
          <TextInput
            ref={inputRef}
            error={pathDoesNotExist ? "Path does not exist" : ""}
            onChange={v => {
              setNewScanDirectory(v.currentTarget.value);
              const result = !findPath(treeData, v.currentTarget.value);
              setPathDoesNotExist(result);
            }}
            placeholder={scanDirectoryPlaceholder}
          />
        </Grid.Col>
        <Grid.Col span={3}>
          {updateAndScan ? (
            <Button
              disabled={isNotValidPath}
              type="submit"
              color="green"
              onClick={() => {
                if (newScanDirectory === "") {
                  setNewScanDirectory(userToEdit.scan_directory);
                }
                const newUserData = {
                  ...userToEdit,
                  scan_directory: newScanDirectory,
                };

                dispatch(updateUserAndScan(newUserData));
                onRequestClose();
              }}
            >
              {t("scan")}
            </Button>
          ) : (
            <Button
              disabled={isNotValidPath}
              type="submit"
              color="green"
              onClick={() => {
                if (newScanDirectory === "") {
                  setNewScanDirectory(userToEdit.scan_directory);
                }
                const newUserData = {
                  ...userToEdit,
                  scan_directory: newScanDirectory,
                };

                dispatch(manageUpdateUser(newUserData));
                onRequestClose();
              }}
            >
              {t("modalscandirectoryedit.update")}
            </Button>
          )}
        </Grid.Col>
      </Grid>
      <Title order={6}>{t("modalscandirectoryedit.explanation3")}</Title>
      <div style={{ height: "250px", overflow: "auto" }}>
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
    </Modal>
  );
}
