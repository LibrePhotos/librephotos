import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Container,
  Divider,
  Group,
  Image,
  PasswordInput,
  Stack,
  Stepper,
  Switch,
  Text,
  TextInput,
  Title,
  useComputedColorScheme,
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
  useSsoConfigQuery,
} from "../api_client/auth";
import { useScanPhotosMutation } from "../api_client/jobs";
import { useGetSettingsQuery } from "../api_client/settings";
import { useUpdateSettingsMutation } from "../api_client/settings/hooks/useUpdateSettingsMutation";
import {
  useCurrentUserSelfDetailsQuery,
  UserListQueryKeys,
  useUpdateUserScanDirectoryMutation,
} from "../api_client/user/hooks";
import { DirectoryPicker } from "../components/setup/DirectoryPicker";
import { uploadLocation } from "../components/setup/uploadLocation";
import { reportSignupError, reportUserSaveError } from "../util/apiErrors";
import { ssoErrorMessageKey } from "../util/ssoErrors";
import { isStringEmpty } from "../util/stringUtils";
import { EMAIL_REGEX } from "../util/util";

/**
 * The protected shell sends a signed-out visitor here with `?redirect=<path>`.
 * Only a path on this origin is honoured, never `//host`, `/\host` or a full
 * URL, so a crafted login link cannot forward the user to another site after
 * they sign in. `/login` itself is dropped so the page cannot loop.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return undefined;
  }
  try {
    // Catches what the URL parser turns into another host, e.g. a tab between the slashes.
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/login" || url.pathname.startsWith("/login/")) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return value;
}

export const Route = createFileRoute("/login")({
  component: Login,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search.redirect),
  }),
});

export interface LocationState {
  from: {
    pathname: string;
  };
}

function LoginPage(): JSX.Element {
  const colorScheme = useComputedColorScheme("dark");
  const { t } = useTranslation();
  const { data: isAuthenticated } = useIsAuthenticatedQuery();
  const { data: siteSettings } = useGetSettingsQuery();
  const { data: ssoConfig } = useSsoConfigQuery();
  // Back to the page that sent the visitor here; already checked in validateSearch.
  const { redirect } = Route.useSearch();
  const target = redirect ?? "/";
  const { mutate: login, isPending: isLoading } = useLoginMutation({ redirectTo: target });
  // The backend redirects here with a full page load, so the query string is the
  // source of truth; there is no router state to carry the reason.
  const ssoErrorKey = useMemo(
    () => ssoErrorMessageKey(new URLSearchParams(window.location.search).get("sso_error")),
    []
  );
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
    // href carries the target with its own query string and replaces `to` when
    // the location is built; `to="."` is only there because Navigate's types
    // require a `to`.
    return <Navigate to="." href={target} replace />;
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

            {ssoErrorKey && (
              <Alert color="red" variant="light" title={t("login.sso.errortitle")}>
                {t(ssoErrorKey)}
              </Alert>
            )}

            <form onSubmit={onSubmit}>
              <Stack>
                {/* The autocomplete tokens are what lets a password manager recognize
                    this pair as a sign-in and offer to remember it; without them the
                    browser is left guessing at a form the SPA mounted after load. */}
                <TextInput
                  required
                  leftSection={<User />}
                  placeholder={t("login.usernameplaceholder")}
                  name="username"
                  autoComplete="username"
                  {...form.getInputProps("username")}
                />
                <PasswordInput
                  required
                  leftSection={<Lock />}
                  placeholder={t("login.passwordplaceholder")}
                  name="password"
                  autoComplete="current-password"
                  {...form.getInputProps("password")}
                />
                <Button
                  variant="gradient"
                  gradient={{ from: "#43cea2", to: "#185a9d" }}
                  type="submit"
                  loading={isLoading}
                >
                  {t("login.login")}
                </Button>
                {siteSettings?.email_configured && (
                  <Anchor href="/password-reset" size="sm" ta="center">
                    {t("passwordreset.forgotpassword")}
                  </Anchor>
                )}
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

            {ssoConfig?.enabled && (
              <>
                <Divider label={t("login.sso.divider")} labelPosition="center" />
                <Stack gap="xs">
                  {ssoConfig.providers.map(provider => (
                    // A plain anchor, not a router link: the browser has to leave
                    // the SPA and hit the backend to start the redirect to the IdP.
                    <Button key={provider.id} component="a" href={provider.login_url} variant="default" fullWidth>
                      {/* The configured label reads as one button ("Sign in with
                          Keycloak"); with several providers it stops being
                          descriptive, so name each one instead. */}
                      {ssoConfig.providers.length > 1 ? provider.name : ssoConfig.label || t("login.sso.button")}
                    </Button>
                  ))}
                </Stack>
              </>
            )}
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

function FirstTimeSetupPage({ onComplete }: FirstTimeSetupProps): JSX.Element {
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
          // A rejected sign-up (username taken, password refused) used to do
          // nothing at all: the button re-enabled and the form said nothing.
          onError: reportSignupError,
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
        { id: currentUser.id, scan_directory: scanDirectory || null },
        {
          onSuccess: () => {
            if (scanDirectory) {
              scanPhotos.mutate();
            }
            onComplete?.();
            navigate({ to: "/" });
          },
          // Without this the wizard just does nothing when the backend rejects
          // the directory, leaving the admin stuck. See issue #492.
          onError: reportUserSaveError,
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
              {/* The account exists once this step is done: going back to it
                  only led to a second sign-up that failed with "user exists". */}
              <Stepper.Step label={t("login.firsttimesetup")} description={t("login.signup")} allowStepSelect={false}>
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
                          {...form.getInputProps("firstName")}
                        />
                        <TextInput
                          required
                          leftSection={<User />}
                          placeholder={t("settings.lastnameplaceholder")}
                          name="lastname"
                          autoComplete="family-name"
                          {...form.getInputProps("lastName")}
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
                      gradient={{ from: "#D38312", to: "#A83279" }}
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

function Login(): JSX.Element {
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
