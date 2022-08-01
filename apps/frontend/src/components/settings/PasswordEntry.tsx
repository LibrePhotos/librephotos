import { Button, PasswordInput, Stack, Text, Title } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Edit } from "tabler-icons-react";

type Props = {
    createNew?: boolean;
    onValidate: (string, boolean) => void;
    closing?: boolean;
}
export function PasswordEntry(props: Props): JSX.Element {

    const { closing, createNew, onValidate } = props;
    
    const [editPasswordMode, setEditPasswordMode] = useState(false);
    const { t } = useTranslation();
    const [newPassword, setNewPassword] = useState("");
    const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
    const [newPasswordError, setNewPasswordError] = useState("");
    const [confirmPasswordError, setConfirmPasswordError] = useState("");

    useEffect(() => {
        validateAndUpdatePassword(newPassword, newPasswordConfirm, closing);
    }, [createNew, closing]);

    const validateAndUpdatePassword = (password, passwordConfirm, closing = false) => {
        setConfirmPasswordError("");
        setNewPasswordError("");
        var validPassword = ""
        var isValid = false;
      
        if (password || passwordConfirm) {
            if (password == passwordConfirm) {
                validPassword = password;
                isValid = true;
                setNewPasswordError("");
                setConfirmPasswordError("");
            } else if (passwordConfirm !== "") {
                setConfirmPasswordError("Passwords must match");
            } else if (closing) {
                setConfirmPasswordError("You must retype the password");
            }
        } else if (editPasswordMode || createNew) {
            setNewPasswordError("Password cannot be blank");
        } else {
            isValid = true;
        }
        
        onValidate(validPassword, isValid);
    };

    return (

        <Stack spacing="xs">
         
          <Title order={6} style={{paddingTop: "15px"}}>
            { createNew ? (
              <Text>Set Password</Text>
              ) : (
                <Text>
                  Change Password
                  <Button variant="subtle"
                    leftIcon={<Edit size={16} />}
                    title="Change password"
                    onClick={() => {
                        setEditPasswordMode(!editPasswordMode);
                        validateAndUpdatePassword(newPassword, newPasswordConfirm);
                    }}
                  />
                </Text>
              )
            }
          </Title>
          
          <PasswordInput
            icon={<Lock />}
            placeholder={t("login.passwordplaceholder")}
            name="password"
            disabled={!editPasswordMode && !createNew}
            required={editPasswordMode}
            value={newPassword}
            error={newPasswordError}
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
            error={confirmPasswordError}
            onChange={(event) => {
              setNewPasswordConfirm(event.currentTarget.value);
              validateAndUpdatePassword(newPassword, event.currentTarget.value);
            }}
          />
        </Stack>
    );

}