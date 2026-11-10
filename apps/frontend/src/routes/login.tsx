import { createFileRoute } from "@tanstack/react-router";
import React, { useState } from "react";
import { useIsFirstTimeSetupQuery } from "../api_client/auth";
import { SESSION_EXPIRED } from "../api_client/session";
import { LoginForm } from "../components/auth/LoginForm";
import { useSessionExpiredNotice } from "../components/auth/useSessionExpiredNotice";
import { FirstTimeSetup } from "../components/setup/FirstTimeSetup";
import { isStringEmpty } from "../util/stringUtils";

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
  validateSearch: (search: Record<string, unknown>): { redirect?: string; session?: typeof SESSION_EXPIRED } => ({
    redirect: safeRedirect(search.redirect),
    session: search.session === SESSION_EXPIRED ? SESSION_EXPIRED : undefined,
  }),
});

export type LocationState = {
  from: {
    pathname: string;
  };
};

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

/** The first-time setup on this page: not (yet) needed, running, or completed. */
type SetupFlow = "none" | "running" | "completed";

function Login(): React.JSX.Element {
  const { redirect, session } = Route.useSearch();
  useSessionExpiredNotice(session === SESSION_EXPIRED, redirect);
  const { data: isFirstTimeSetup, isLoading } = useIsFirstTimeSetupQuery();
  const [setup, setSetup] = useState<SetupFlow>("none");
  // Once started, the setup runs to its end: its sign-up turns the server's answer false.
  if (setup === "none" && !isLoading && isFirstTimeSetup) {
    setSetup("running");
  }

  if (setup === "running") {
    return (
      <div className="login-page">
        <FirstTimeSetup onComplete={() => setSetup("completed")} />
      </div>
    );
  }

  return (
    <div className="login-page">
      <LoginForm redirect={redirect} />
    </div>
  );
}
