import {
  Button,
  Card,
  Container,
  Group,
  Image,
  PasswordInput,
  Stack,
  Stepper,
  Switch,
  Text,
  TextInput,
  useComputedColorScheme,
} from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import type { UseFormReturnType } from "@mantine/form";
import { IconLock as Lock, IconMail as Mail, IconUser as User } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import type { FormEventHandler } from "react";
import { useTranslation } from "react-i18next";
import { useLoginMutation, useSignUpMutation } from "../../api_client/auth";
import { useScanPhotosMutation } from "../../api_client/jobs";
import { useGetSettingsQuery } from "../../api_client/settings";
import { useUpdateSettingsMutation } from "../../api_client/settings/hooks/useUpdateSettingsMutation";
import { useCurrentUserSelfDetailsQuery, useUpdateUserScanDirectoryMutation } from "../../api_client/user/hooks";
import { userKeys } from "../../api_client/user/keys";
import { makeSignupSchema } from "../../routes/-signup.schema";
import { SIGN_UP_GRADIENT } from "../../theme/brandGradients";
import { reportSignupError, reportUserSaveError } from "../../util/apiErrors";
import { DirectoryPicker } from "./DirectoryPicker";
import { uploadLocation } from "./uploadLocation";

type FirstTimeSetupProps = {
  onComplete?: () => void;
};

type SetupAccountValues = {
  username: string;
  password: string;
  first_name: string;
  last_name: string;
  passwordConfirm: string;
  email: string;
};

type SetupAccountFormProps = {
  form: UseFormReturnType<SetupAccountValues>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  disabled: boolean;
};

/** The first step: the admin account. */
function SetupAccountForm({ form, onSubmit, disabled }: SetupAccountFormProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Stack mt="md">
      <form onSubmit={onSubmit}>
        <Stack>
          <TextInput
            required
            leftSection={<User />}
            placeholder={t("login.usernameplaceholder")}
            name="username"
            autoComplete="username"
            {...form.getInputProps("username")}
          />
          <TextInput
            required
            leftSection={<Mail />}
            placeholder={t("settings.emailplaceholder")}
            name="email"
            autoComplete="email"
            {...form.getInputProps("email")}
          />
          <Group grow>
            <TextInput
              required
              leftSection={<User />}
              placeholder={t("settings.firstnameplaceholder")}
              name="firstname"
              autoComplete="given-name"
              {...form.getInputProps("first_name")}
            />
            <TextInput
              required
              leftSection={<User />}
              placeholder={t("settings.lastnameplaceholder")}
              name="lastname"
              autoComplete="family-name"
              {...form.getInputProps("last_name")}
            />
          </Group>
          <Group grow>
            <PasswordInput
              required
              leftSection={<Lock />}
              placeholder={t("login.passwordplaceholder")}
              name="password"
              autoComplete="new-password"
              {...form.getInputProps("password")}
            />
            <PasswordInput
              required
              leftSection={<Lock />}
              placeholder={t("login.confirmpasswordplaceholder")}
              name="passwordConfirm"
              autoComplete="new-password"
              {...form.getInputProps("passwordConfirm")}
            />
          </Group>

          <Button variant="gradient" gradient={SIGN_UP_GRADIENT} type="submit" disabled={disabled}>
            {t("login.signup")}
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}

export function FirstTimeSetup({ onComplete }: FirstTimeSetupProps): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mutate: signup, isPending: isSignupPending } = useSignUpMutation();
  const { mutate: login, isPending: isLoginPending } = useLoginMutation({ navigateOnSuccess: false });
  const { mutate: updateScanDirectory, isPending: isUpdatePending } = useUpdateUserScanDirectoryMutation();
  const { mutate: updateSettings, isPending: isSettingsPending } = useUpdateSettingsMutation();
  const { data: siteSettings } = useGetSettingsQuery();
  const scanPhotos = useScanPhotosMutation();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const [activeStep, setActiveStep] = useState(0);
  const [scanDirectory, setScanDirectory] = useState("");
  const [isPathValid, setIsPathValid] = useState(true);
  // Null without a scan directory: the backend refuses uploads then.
  const webUploadLocation = uploadLocation(scanDirectory);
  const [allowUpload, setAllowUpload] = useState<boolean | null>(null);
  const [allowRegistration, setAllowRegistration] = useState<boolean | null>(null);
  const isSavingDirectory = isUpdatePending || scanPhotos.isPending;
  const isSavingSettings = isSettingsPending;

  const form = useForm({
    initialValues: {
      username: "",
      password: "",
      first_name: "",
      last_name: "",
      passwordConfirm: "",
      email: "",
    },
    validate: schemaResolver(makeSignupSchema(t), { sync: true }),
  });

  const colorScheme = useComputedColorScheme();
  const dark = colorScheme === "dark";

  useEffect(() => {
    if (siteSettings) {
      setAllowUpload(siteSettings.allow_upload);
      setAllowRegistration(siteSettings.allow_registration);
    }
  }, [siteSettings]);

  function onSignUp(values: typeof form.values): void {
    const { email, first_name: firstName, last_name: lastName, password } = values;
    const username = values.username.toLowerCase();
    signup(
      { email, first_name: firstName, last_name: lastName, username, password },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: userKeys.list() });
          login(
            { username, password },
            {
              onSuccess: () => {
                setActiveStep(1);
              },
            }
          );
        },
        // A rejected sign-up (username taken, password refused) used to do
        // nothing at all: the button re-enabled and the form said nothing.
        onError: reportSignupError,
      }
    );
  }

  const canSaveDirectory = useMemo(() => {
    if (!scanDirectory) {
      return true;
    }
    return isPathValid;
  }, [scanDirectory, isPathValid]);

  const settingsChanged =
    siteSettings &&
    allowUpload !== null &&
    allowRegistration !== null &&
    (allowUpload !== siteSettings.allow_upload || allowRegistration !== siteSettings.allow_registration);

  const handleSiteSettingsNext = () => {
    const goNext = () => setActiveStep(2);
    if (settingsChanged) {
      updateSettings(
        { allow_upload: allowUpload ?? false, allow_registration: allowRegistration ?? false },
        {
          onSuccess: goNext,
          onError: goNext,
        }
      );
      return;
    }
    goNext();
  };

  const handleFinish = () => {
    if (!canSaveDirectory) {
      return;
    }
    if (currentUser) {
      updateScanDirectory(
        { id: currentUser.id, scan_directory: scanDirectory || null },
        {
          onSuccess: () => {
            if (scanDirectory) {
              scanPhotos.mutate();
            }
            onComplete?.();
            void navigate({ to: "/" });
          },
          // Without this the wizard just does nothing when the backend rejects
          // the directory, leaving the admin stuck. See issue #492.
          onError: reportUserSaveError,
        }
      );
      return;
    }
    onComplete?.();
    void navigate({ to: "/" });
  };

  return (
    <div
      style={{
        paddingTop: 150,
        position: "fixed",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        overflowY: "auto",
        backgroundSize: "cover",
      }}
    >
      <Stack align="center" justify="flex-end">
        <Group gap="xs" justify="center">
          <Image height={80} width={80} fit="contain" src={dark ? "/logo-white.png" : "/logo.png"} />
          <span style={{ fontSize: 18 }}>
            <b>{t("login.name")}</b>
          </span>
        </Group>

        <Container size="xl" px="md" style={{ width: "100%" }}>
          <Card shadow="xl" w="100%" maw={800} mx="auto">
            <Stepper active={activeStep} onStepClick={setActiveStep} allowNextStepsSelect={false} size="sm">
              {/* The account exists once this step is done: going back to it
                  only led to a second sign-up that failed with "user exists". */}
              <Stepper.Step label={t("login.firsttimesetup")} description={t("login.signup")} allowStepSelect={false}>
                <SetupAccountForm
                  form={form}
                  onSubmit={form.onSubmit(onSignUp)}
                  disabled={isSignupPending || isLoginPending}
                />
              </Stepper.Step>
              <Stepper.Step label={t("adminarea.sitesettings")} description={t("login.setupsitesettings")}>
                <Stack mt="md" gap="md">
                  <Switch
                    label={t("sitesettings.headerupload")}
                    checked={!!allowUpload}
                    onChange={event => setAllowUpload(event.currentTarget.checked)}
                  />
                  <Switch
                    label={t("sitesettings.header")}
                    checked={!!allowRegistration}
                    onChange={event => setAllowRegistration(event.currentTarget.checked)}
                  />
                  <Group justify="flex-end">
                    <Button
                      variant="gradient"
                      gradient={SIGN_UP_GRADIENT}
                      onClick={handleSiteSettingsNext}
                      disabled={isSavingSettings || allowUpload === null || allowRegistration === null}
                    >
                      {t("continue")}
                    </Button>
                  </Group>
                </Stack>
              </Stepper.Step>
              <Stepper.Step label={t("settings.scandirectory")} description={t("login.setupdatadirectory")}>
                <Stack mt="md" gap="md">
                  <DirectoryPicker
                    value={scanDirectory}
                    onChange={setScanDirectory}
                    onValidityChange={setIsPathValid}
                    placeholder="/data"
                    label={<Text fw="bold">{t("modalscandirectoryedit.currentdirectory")}</Text>}
                    // Explanatory text, not a heading; matches the user dialog's picker.
                    description={
                      <Text size="sm" c="dimmed" mt="xs">
                        {t("modalscandirectoryedit.explanation3")}
                      </Text>
                    }
                    missingPathError={t("modalscandirectoryedit.pathdoesnotexist")}
                    // Only where uploads are on and the path exists: the hint is about a
                    // folder the server will really write to. Under the input it describes,
                    // as in the user dialog, not below the folder tree.
                    hint={
                      allowUpload && isPathValid && webUploadLocation ? (
                        <Text size="sm" c="dimmed" mt={4} style={{ overflowWrap: "anywhere" }}>
                          {t("modalscandirectoryedit.uploadlocation", { path: webUploadLocation })}
                        </Text>
                      ) : undefined
                    }
                  />
                  <Group justify="space-between">
                    <Button variant="default" onClick={() => void navigate({ to: "/" })}>
                      {t("skip")}
                    </Button>
                    <Button
                      variant="gradient"
                      gradient={SIGN_UP_GRADIENT}
                      onClick={handleFinish}
                      disabled={
                        isSavingDirectory ||
                        !canSaveDirectory ||
                        !currentUser ||
                        allowUpload === null ||
                        allowRegistration === null
                      }
                    >
                      {scanDirectory ? t("save") : t("continue")}
                    </Button>
                  </Group>
                </Stack>
              </Stepper.Step>
            </Stepper>
          </Card>
        </Container>
      </Stack>
    </div>
  );
}
