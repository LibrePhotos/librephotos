import {
  Button,
  Card,
  Container,
  Center,
  Divider,
  Grid,
  Group,
  Image,
  PasswordInput,
  Stack,
  Stepper,
  Text,
  TextInput,
  Title,
  useComputedColorScheme,
  Switch,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconLock as Lock, IconMail as Mail, IconUser as User } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  useIsAuthenticatedQuery,
  useIsFirstTimeSetupQuery,
  useLoginMutation,
  useSignUpMutation,
} from "../api_client/auth";
import { useGetSettingsQuery } from "../api_client/settings";
import { useUpdateSettingsMutation } from "../api_client/settings/hooks/useUpdateSettingsMutation";
import { UserListQueryKeys, useCurrentUserSelfDetailsQuery, useUpdateUserScanDirectoryMutation } from "../api_client/user/hooks";
import { isStringEmpty } from "../util/stringUtils";
import { EMAIL_REGEX } from "../util/util";
import { DirectoryPicker } from "../components/setup/DirectoryPicker";
import { useScanPhotosMutation } from "../api_client/jobs";

export const Route = createFileRoute("/login")();

export interface LocationState {
  from: {
    pathname: string;
  };
}

export function LoginPage(): JSX.Element {
  const colorScheme = useComputedColorScheme("dark");
  const { t } = useTranslation();
  const { data: isAuthenticated } = useIsAuthenticatedQuery();
  const { data: siteSettings } = useGetSettingsQuery();
  const { mutate: login, isPending: isLoading } = useLoginMutation();
  const form = useForm({
    initialValues: {
      username: "",
      password: "",
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    login({ username: form.values.username.toLowerCase(), password: form.values.password });
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <Stack align="center" justify="flex-end" pt={150}>
      <Group gap="xs" justify="center">
        <Image height={80} width={80} fit="contain" src={colorScheme === "dark" ? "/logo-white.png" : "/logo.png"} />
        <span style={{ fontSize: 18 }}>
          <b>{t("login.name")}</b>
        </span>
      </Group>
      <div className="login-form">
        <Card>
          <Stack>
            <Title order={3}>{t("login.login")}</Title>

            <form onSubmit={onSubmit}>
              <Stack>
                <TextInput
                  required
                  leftSection={<User />}
                  placeholder={t("login.usernameplaceholder")}
                  name="username"
                  {...form.getInputProps("username")}
                />
                <PasswordInput
                  required
                  leftSection={<Lock />}
                  placeholder={t("login.passwordplaceholder")}
                  name="password"
                  {...form.getInputProps("password")}
                />
                <Button variant="gradient" gradient={{ from: "#43cea2", to: "#185a9d" }} type="submit">
                  {t("login.login")}
                </Button>
                {siteSettings && siteSettings.allow_registration && (
                  <Button
                    disabled={!siteSettings.allow_registration || isLoading}
                    component="a"
                    href="/signup"
                    variant="gradient"
                    gradient={{ from: "#D38312", to: "#A83279" }}
                  >
                    {t("login.signup")}
                  </Button>
                )}
              </Stack>
            </form>
          </Stack>
        </Card>
      </div>
      <Center>{t("login.tagline")}</Center>
    </Stack>
  );
}

export type SignUpForm = {
  username: string;
  password: string;
  firstname: string;
  lastname: string;
  passwordConfirm: string;
  email: string;
};

export type SignInForm = {
  username: string;
  password: string;
};

export function validateSignUpForm(form: SignUpForm): boolean {
  return (
    isStringEmpty(form.username) &&
    isStringEmpty(form.password) &&
    isStringEmpty(form.firstname) &&
    isStringEmpty(form.lastname) &&
    isStringEmpty(form.passwordConfirm) &&
    isStringEmpty(form.email) &&
    form.password === form.passwordConfirm
  );
}

export function validateSignInForm(form: SignInForm): boolean {
  return isStringEmpty(form.username) && isStringEmpty(form.password);
}

export const initialFormState: SignUpForm = {
  username: "",
  password: "",
  firstname: "",
  lastname: "",
  passwordConfirm: "",
  email: "",
};

export type FirstTimeSetupProps = {
  onComplete?: () => void;
};

export function FirstTimeSetupPage({ onComplete }: FirstTimeSetupProps): JSX.Element {
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
  const [stackRawJpeg, setStackRawJpeg] = useState(true);
  const [allowUpload, setAllowUpload] = useState<boolean | null>(null);
  const [allowRegistration, setAllowRegistration] = useState<boolean | null>(null);
  const isSavingDirectory = isUpdatePending || scanPhotos.isPending;
  const isSavingSettings = isSettingsPending;

  const form = useForm({
    initialValues: {
      username: "",
      password: "",
      firstName: "",
      lastName: "",
      passwordConfirm: "",
      email: "",
    },

    validate: {
      passwordConfirm: (value, values) => (value !== values.password ? t("settings.password.errormustmatch") : null),
      email: value => (!EMAIL_REGEX.test(value) ? t("modaluseredit.errorinvalidemail") : null),
    },
  });

  const colorScheme = useComputedColorScheme();
  const dark = colorScheme === "dark";

  useEffect(() => {
    if (currentUser?.stack_raw_jpeg !== undefined) {
      setStackRawJpeg(currentUser.stack_raw_jpeg);
    }
  }, [currentUser]);

  useEffect(() => {
    if (siteSettings) {
      setAllowUpload(siteSettings.allow_upload);
      setAllowRegistration(siteSettings.allow_registration);
    }
  }, [siteSettings]);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = form.validate();
    if (!result.hasErrors) {
      const { email, firstName, lastName, password } = form.values;
      const username = form.values.username.toLowerCase();
      signup(
        { email, first_name: firstName, last_name: lastName, username, password },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: UserListQueryKeys });
            login(
              { username, password },
              {
                onSuccess: () => {
                  setActiveStep(1);
                },
              }
            );
          },
        }
      );
    }
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
        { id: currentUser.id, scan_directory: scanDirectory || null, stack_raw_jpeg: stackRawJpeg },
        {
          onSuccess: () => {
            if (scanDirectory) {
              scanPhotos.mutate();
            }
            onComplete?.();
            navigate({ to: "/" });
          },
        }
      );
      return;
    }
    onComplete?.();
    navigate({ to: "/" });
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
              <Stepper.Step label={t("login.firsttimesetup")} description={t("login.signup")}>
                <Stack mt="md">
                  <form onSubmit={onSubmit}>
                    <Stack>
                      <TextInput
                        required
                        leftSection={<User />}
                        placeholder={t("login.usernameplaceholder")}
                        name="username"
                        {...form.getInputProps("username")}
                      />
                      <TextInput
                        required
                        leftSection={<Mail />}
                        placeholder={t("settings.emailplaceholder")}
                        name="email"
                        {...form.getInputProps("email")}
                      />
                      <Group grow>
                        <TextInput
                          required
                          leftSection={<User />}
                          placeholder={t("settings.firstnameplaceholder")}
                          name="firstname"
                          {...form.getInputProps("firstName")}
                        />
                        <TextInput
                          required
                          leftSection={<User />}
                          placeholder={t("settings.lastnameplaceholder")}
                          name="firstname"
                          {...form.getInputProps("lastName")}
                        />
                      </Group>
                      <Group grow>
                        <PasswordInput
                          leftSection={<Lock />}
                          placeholder={t("login.passwordplaceholder")}
                          name="password"
                          {...form.getInputProps("password")}
                        />
                        <PasswordInput
                          required
                          leftSection={<Lock />}
                          placeholder={t("login.confirmpasswordplaceholder")}
                          name="passwordConfirm"
                          {...form.getInputProps("passwordConfirm")}
                        />
                      </Group>

                      <Button
                        variant="gradient"
                        gradient={{ from: "#D38312", to: "#A83279" }}
                        type="submit"
                        disabled={isSignupPending || isLoginPending}
                      >
                        {t("login.signup")}
                      </Button>
                    </Stack>
                  </form>
                </Stack>
              </Stepper.Step>
              <Stepper.Step label={t("sitesettings.header")} description={t("sitesettings.headerupload")}>
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
                      gradient={{ from: "#D38312", to: "#A83279" }}
                      onClick={handleSiteSettingsNext}
                      disabled={
                        isSavingSettings ||
                        allowUpload === null ||
                        allowRegistration === null
                      }
                    >
                      {t("continue")}
                    </Button>
                  </Group>
                </Stack>
              </Stepper.Step>
              <Stepper.Step label={t("modalscandirectoryedit.header")} description={t("login.setupdatadirectory")}>
                <Stack mt="md" gap="md">
                  <Grid>
                    <Grid.Col span={{ base: 12, sm: 10 }}>
                      <Stack gap={0}>
                        <Text>{t("sitesettings.stack_raw_jpeg")}</Text>
                        <Text fz="sm" c="dimmed">
                          {t("settings.stack_raw_jpeg_note")}
                        </Text>
                      </Stack>
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 2 }}>
                      <Switch
                        checked={stackRawJpeg}
                        onChange={event => setStackRawJpeg(event.currentTarget.checked)}
                      />
                    </Grid.Col>
                  </Grid>
                  <Divider my="sm" />
                  <DirectoryPicker
                    value={scanDirectory}
                    onChange={setScanDirectory}
                    onValidityChange={setIsPathValid}
                    placeholder="/data"
                    label={<Text fw="bold">{t("modalscandirectoryedit.currentdirectory")}</Text>}
                    description={<Title order={6}>{t("modalscandirectoryedit.explanation3")}</Title>}
                    missingPathError={t("modalscandirectoryedit.pathdoesnotexist")}
                  />
                  <Group justify="space-between">
                    <Button variant="default" onClick={() => navigate({ to: "/" })}>
                      {t("skip")}
                    </Button>
                    <Button
                      variant="gradient"
                      gradient={{ from: "#D38312", to: "#A83279" }}
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

export function Login(): JSX.Element {
  const { data: isFirstTimeSetup, isLoading } = useIsFirstTimeSetupQuery();
  const [firstTimeFlow, setFirstTimeFlow] = useState(false);

  useEffect(() => {
    if (!isLoading && isFirstTimeSetup) {
      setFirstTimeFlow(true);
    }
  }, [isFirstTimeSetup, isLoading]);

  if (firstTimeFlow || (!isLoading && isFirstTimeSetup)) {
    return (
      <div className="login-page">
        <FirstTimeSetupPage
          onComplete={() => {
            setFirstTimeFlow(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="login-page">
      <LoginPage />
    </div>
  );
}

Route.update({ component: Login });
