import { userKeys } from "@librephotos/api-client";
import { Button, Group, Stack, Stepper, Switch, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import type { UseFormReturnType } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { isEqual } from "lodash-es";
import React, { useMemo, useState } from "react";
import type { FormEventHandler } from "react";
import { useTranslation } from "react-i18next";
import { useLoginMutation, useSignUpMutation } from "../../api_client/auth";
import { useScanPhotosMutation } from "../../api_client/jobs";
import { useGetSettingsQuery } from "../../api_client/settings";
import { useUpdateSettingsMutation } from "../../api_client/settings/hooks/useUpdateSettingsMutation";
import { useCurrentUserSelfDetailsQuery, useUpdateUserScanDirectoryMutation } from "../../api_client/user/hooks";
import { useServerDraft } from "../../hooks/useServerDraft";
import { makeSignupSchema } from "../../routes/-signup.schema";
import { reportSignupError, reportUserSaveError } from "../../util/apiErrors";
import { AuthCard } from "../auth/AuthCard";
import { SignupFields } from "../auth/SignupFields";
import type { SignupValues } from "../auth/SignupFields";
import { DirectoryPicker } from "./DirectoryPicker";
import classes from "./FirstTimeSetup.module.css";
import { SetupErrorReportingStep } from "./SetupErrorReportingStep";
import { uploadLocation } from "./uploadLocation";

// The steps after the account (0) and the site settings (1).
const STEP_ERRORS = 2;
const STEP_LIBRARY = 3;

type FirstTimeSetupProps = {
  onComplete?: () => void;
};

/**
 * The admin account: `new` until the sign-up went through, then `created`. A sign-in that fails
 * after it is tried again on its own: signing up again only said "user exists".
 */
type AccountStage = "new" | "created";

type SetupAccountFormProps = {
  form: UseFormReturnType<SignupValues>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  disabled: boolean;
  stage: AccountStage;
};

/** The first step: the admin account. */
function SetupAccountForm({ form, onSubmit, disabled, stage }: SetupAccountFormProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <form onSubmit={onSubmit}>
      <Stack>
        <SignupFields form={form} />
        {stage === "created" ? (
          <Text size="sm" c="dimmed">
            {t("login.setupsigninagain")}
          </Text>
        ) : null}
        <Button type="submit" fullWidth disabled={disabled}>
          {stage === "created" ? t("login.signin") : t("login.createadmin")}
        </Button>
      </Stack>
    </form>
  );
}

export function FirstTimeSetup({ onComplete }: FirstTimeSetupProps): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mutate: signup, isPending: isSignupPending } = useSignUpMutation({ reportsErrors: true });
  const { mutate: login, isPending: isLoginPending } = useLoginMutation({ navigateOnSuccess: false });
  const { mutate: updateScanDirectory, isPending: isUpdatePending } = useUpdateUserScanDirectoryMutation({
    reportsErrors: true,
  });
  const { mutateAsync: updateSettings } = useUpdateSettingsMutation();
  const { data: siteSettings } = useGetSettingsQuery();
  // The two switches start from the stored settings; a fetch of them (window focus) leaves a flip alone.
  const toggles = useServerDraft(
    siteSettings && { allow_upload: siteSettings.allow_upload, allow_registration: siteSettings.allow_registration },
    {
      save: async values => {
        if (!values) return true;
        try {
          await updateSettings(values);
          return true;
        } catch {
          return false;
        }
      },
      isEqual,
      // A refused save is toasted by the QueryClient; the step stays with the switches as set.
      keepOnFailure: true,
    }
  );
  const scanPhotos = useScanPhotosMutation();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const [activeStep, setActiveStep] = useState(0);
  const [account, setAccount] = useState<AccountStage>("new");
  const [scanDirectory, setScanDirectory] = useState("");
  const [isPathValid, setIsPathValid] = useState(true);
  // Null without a scan directory: the backend refuses uploads then.
  const webUploadLocation = uploadLocation(scanDirectory);
  const allowUpload = toggles.value?.allow_upload ?? null;
  const allowRegistration = toggles.value?.allow_registration ?? null;
  const isSavingDirectory = isUpdatePending || scanPhotos.isPending;
  const isSavingSettings = toggles.status === "saving";

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

  function onSignUp(values: typeof form.values): void {
    const { email, first_name: firstName, last_name: lastName, password } = values;
    const username = values.username.toLowerCase();
    const signIn = () => login({ username, password }, { onSuccess: () => setActiveStep(1) });
    if (account === "created") {
      signIn();
      return;
    }
    signup(
      { email, first_name: firstName, last_name: lastName, username, password },
      {
        onSuccess: () => {
          setAccount("created");
          void queryClient.invalidateQueries({ queryKey: userKeys.list() });
          signIn();
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

  // Unchanged switches send nothing; a refused save stays on the step so it can be retried
  // instead of skipping it without a word (#2224).
  const handleSiteSettingsNext = () =>
    void toggles.commit().then(saved => {
      if (saved) setActiveStep(STEP_ERRORS);
    });

  const flip = (field: "allow_upload" | "allow_registration", checked: boolean) =>
    toggles.update(values => values && { ...values, [field]: checked });

  // Finish and Skip both end the setup here, then open the app.
  const finish = () => {
    onComplete?.();
    void navigate({ to: "/" });
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
            finish();
          },
          // Without this the wizard just does nothing when the backend rejects
          // the directory, leaving the admin stuck. See issue #492.
          onError: reportUserSaveError,
        }
      );
      return;
    }
    finish();
  };

  // Each step's label under its dot and the line under the heading.
  const steps = [
    { label: t("login.setupstepaccount"), description: t("login.setupadmin") },
    { label: t("login.setupstepsettings"), description: t("login.setupsitesettings") },
    { label: t("errorreports.setup_step"), description: t("errorreports.setup_description") },
    { label: t("login.setupsteplibrary"), description: t("login.setupdatadirectory") },
  ];

  return (
    <AuthCard
      title={t("login.setuptitle")}
      description={steps[activeStep]?.description}
      top={
        <Stepper
          active={activeStep}
          onStepClick={setActiveStep}
          allowNextStepsSelect={false}
          size="xs"
          classNames={{
            step: classes.step,
            stepBody: classes.stepBody,
            stepLabel: classes.stepLabel,
            separator: classes.separator,
          }}
        >
          {/* The account exists once this step is done: going back to it
              only led to a second sign-up that failed with "user exists". */}
          {steps.map(({ label }, index) => (
            <Stepper.Step key={label} label={label} allowStepSelect={index === 0 ? false : undefined} />
          ))}
        </Stepper>
      }
    >
      {activeStep === 0 && (
        <SetupAccountForm
          form={form}
          onSubmit={form.onSubmit(onSignUp)}
          disabled={isSignupPending || isLoginPending}
          stage={account}
        />
      )}
      {activeStep === 1 && (
        <Stack gap="md">
          <Switch
            label={t("sitesettings.headerupload")}
            checked={!!allowUpload}
            onChange={event => flip("allow_upload", event.currentTarget.checked)}
          />
          <Switch
            label={t("sitesettings.header")}
            checked={!!allowRegistration}
            onChange={event => flip("allow_registration", event.currentTarget.checked)}
          />
          <Group grow>
            <Button
              onClick={handleSiteSettingsNext}
              disabled={isSavingSettings || allowUpload === null || allowRegistration === null}
            >
              {t("continue")}
            </Button>
          </Group>
        </Stack>
      )}
      {activeStep === STEP_ERRORS && <SetupErrorReportingStep onDone={() => setActiveStep(STEP_LIBRARY)} />}
      {activeStep === STEP_LIBRARY && (
        <Stack gap="md">
          <DirectoryPicker
            value={scanDirectory}
            onChange={setScanDirectory}
            onValidityChange={setIsPathValid}
            placeholder="/data"
            label={t("modalscandirectoryedit.currentdirectory")}
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
          <Group grow>
            <Button variant="light" onClick={finish}>
              {t("skip")}
            </Button>
            <Button
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
      )}
    </AuthCard>
  );
}
