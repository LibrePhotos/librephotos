import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useIsFirstTimeSetupQuery } from "../api_client/auth";
import { LoginForm } from "../components/auth/LoginForm";
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
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search.redirect),
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

function Login(): React.JSX.Element {
  const { redirect } = Route.useSearch();
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
        <FirstTimeSetup
          onComplete={() => {
            setFirstTimeFlow(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="login-page">
      <LoginForm redirect={redirect} />
    </div>
  );
}
