import type { TFunction } from "i18next";
import { z } from "zod";

/** The e-mail settings card. The server checks the rest; the port is positive there too. */
export function makeEmailSettingsSchema(t: TFunction) {
  const portError = t("emailsettings.errorport");
  return z.object({
    provider: z.string(),
    from_email: z.string(),
    host: z.string(),
    port: z.number().int({ error: portError }).min(1, { error: portError }),
    use_tls: z.boolean(),
    use_ssl: z.boolean(),
    username: z.string(),
    secret: z.string(),
  });
}
