import { LoginScreen } from "./LoginScreen";
import { makeMockClient, renderWithProviders } from "@/test/test-utils";

describe("LoginScreen", () => {
  it("renders the server-URL-first login form", () => {
    const client = makeMockClient(async () => new Response("{}", { status: 200 }));
    const { getByTestId } = renderWithProviders(<LoginScreen />, client);

    // Server URL field comes first (self-hosted).
    expect(getByTestId("login-title")).toBeTruthy();
    expect(getByTestId("login-server")).toBeTruthy();
    expect(getByTestId("login-username")).toBeTruthy();
    expect(getByTestId("login-password")).toBeTruthy();
    expect(getByTestId("login-submit")).toBeTruthy();
  });
});
