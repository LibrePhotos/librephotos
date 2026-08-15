import { describe, expect, it } from "vitest";
import { ssoErrorMessageKey } from "./ssoErrors";

describe("ssoErrorMessageKey", () => {
  it("returns null when there is no error", () => {
    expect(ssoErrorMessageKey(null)).toBeNull();
    expect(ssoErrorMessageKey(undefined)).toBeNull();
    expect(ssoErrorMessageKey("")).toBeNull();
  });

  it("maps each reason the backend can send", () => {
    expect(ssoErrorMessageKey("signup_disabled")).toBe("login.sso.errorsignupdisabled");
    expect(ssoErrorMessageKey("email_not_verified")).toBe("login.sso.erroremailnotverified");
    expect(ssoErrorMessageKey("not_authenticated")).toBe("login.sso.errornotauthenticated");
    expect(ssoErrorMessageKey("public_url_not_configured")).toBe("login.sso.errorpublicurlnotconfigured");
  });

  it("still says something for a reason it does not know", () => {
    expect(ssoErrorMessageKey("something_new_from_a_newer_backend")).toBe("login.sso.errorunknown");
  });
});
