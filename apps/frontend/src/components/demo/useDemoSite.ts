import { useGetSettingsQuery } from "../../api_client/settings";

export type DemoSite = { username: string; password: string };

export function useDemoSite(): DemoSite | null {
  const { data } = useGetSettingsQuery();
  if (!data?.demo_site) return null;
  return { username: data.demo_username ?? "", password: data.demo_password ?? "" };
}
