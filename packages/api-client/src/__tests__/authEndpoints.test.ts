/**
 * The auth endpoints the web and mobile apps share (issue #2347): the request each one sends and
 * the parsed answer, against the backend's answers.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { ResponseParseError } from "../util/parse";
import { defined } from "./defined";
import ssoConfig from "./fixtures/ssoConfig.json";
import { fakeServer } from "./harness";

describe("logout", () => {
  it("blacklists the refresh token and reads simplejwt's empty answer", async () => {
    const { client, requests } = fakeServer({});
    await expect(endpoints.logout(client, "r1")).resolves.toEqual({});
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/auth/token/blacklist/",
      method: "POST",
      body: { refresh: "r1" },
    });
  });

  it("leaves a missing refresh token out of the body, as the web always sent it", async () => {
    const { client, requests } = fakeServer({});
    await endpoints.logout(client, undefined);
    expect(defined(requests[0]).body).toEqual({});
  });
});

describe("sign-up and first-time setup", () => {
  it("creates a user and parses the SignupUser answer", async () => {
    const answer = { username: "ann", email: "", first_name: "Ann", last_name: "Lee" };
    const { client, requests } = fakeServer(answer);
    const body = { username: "ann", password: "pw", email: "", first_name: "Ann", last_name: "Lee" };
    await expect(endpoints.signUp(client, body)).resolves.toEqual(answer);
    expect(defined(requests[0])).toEqual({ url: "https://demo.example.com/api/user/", method: "POST", body });
  });

  it("reads whether the instance has an admin yet", async () => {
    const { client, requests } = fakeServer({ isFirstTimeSetup: true });
    await expect(endpoints.fetchIsFirstTimeSetup(client)).resolves.toEqual({ isFirstTimeSetup: true });
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/firsttimesetup/");
  });
});

describe("single sign-on config", () => {
  it("parses the login screen's providers", async () => {
    const { client, requests } = fakeServer(ssoConfig);
    const config = await endpoints.fetchSsoConfig(client);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/auth/sso/config/");
    expect(config.enabled).toBe(true);
    expect(defined(config.providers[0]).login_url).toBe("/api/accounts/oidc/authentik/login/");
  });

  it("parses SSO switched off", async () => {
    const { client } = fakeServer({ enabled: false, label: "Single sign-on", providers: [] });
    await expect(endpoints.fetchSsoConfig(client)).resolves.toMatchObject({ enabled: false, providers: [] });
  });
});

describe("password reset", () => {
  const answer = { status: true, message: "If an account exists for that email, a reset link has been sent." };

  it("asks for a reset link by email", async () => {
    const { client, requests } = fakeServer(answer);
    await expect(endpoints.requestPasswordReset(client, "ann@example.com")).resolves.toEqual(answer);
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/auth/password/reset/",
      method: "POST",
      body: { email: "ann@example.com" },
    });
  });

  it("confirms a new password with the link's uid and token", async () => {
    const { client, requests } = fakeServer({ status: true, message: "Password has been reset" });
    const body = { uid: "MQ", token: "abc-123", new_password: "a long new password" };
    await endpoints.confirmPasswordReset(client, body);
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/auth/password/reset/confirm/",
      method: "POST",
      body,
    });
  });

  it("rejects an answer of another shape as server drift", async () => {
    const { client } = fakeServer({ detail: "ok" });
    await expect(endpoints.requestPasswordReset(client, "ann@example.com")).rejects.toBeInstanceOf(ResponseParseError);
  });
});
