import { useAuthStore } from "@/stores/auth";

/** An unsigned access token whose payload is `claims`, base64url without padding (as JWTs are). */
function token(claims: object): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `e30.${payload}.sig`;
}

/** The user id the store derives from logging in with `access`. */
async function userIdAfterLogin(access: string): Promise<number | null> {
  await useAuthStore.getState().onLoggedIn(access, "refresh");
  return useAuthStore.getState().userId;
}

describe("auth store: user id from the access token", () => {
  afterEach(() => {
    useAuthStore.setState({ status: "unknown", userId: null });
  });

  it("reads a numeric string user_id (simplejwt >= 5.5) and a number (older servers)", async () => {
    expect(await userIdAfterLogin(token({ user_id: "7" }))).toBe(7);
    expect(await userIdAfterLogin(token({ user_id: 7 }))).toBe(7);
  });

  it("gives null, not NaN, for a user_id that is not a number", async () => {
    expect(await userIdAfterLogin(token({ user_id: "abc" }))).toBeNull();
    expect(await userIdAfterLogin(token({ user_id: "7.5" }))).toBeNull();
    expect(await userIdAfterLogin(token({ sub: "7" }))).toBeNull();
  });

  describe("with a strict base64 decoder", () => {
    const realAtob = globalThis.atob;
    beforeEach(() => {
      // Node's atob forgives missing padding; a spec-strict decoder (base64
      // polyfills, some JS engines) rejects input whose length is not a multiple
      // of 4. JWT segments are unpadded, so the payload must be padded first.
      globalThis.atob = (input: string) => {
        if (input.length % 4 !== 0) throw new Error("InvalidCharacterError: bad padding");
        return realAtob(input);
      };
    });
    afterEach(() => {
      globalThis.atob = realAtob;
    });

    it("pads the payload before decoding it", async () => {
      const access = token({ user_id: 7 });
      expect(access.split(".")[1].length % 4).not.toBe(0); // the payload needs padding
      expect(await userIdAfterLogin(access)).toBe(7);
    });
  });
});
