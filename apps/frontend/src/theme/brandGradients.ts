import type { MantineGradient } from "@mantine/core";

// The brand's two gradient buttons (`variant="gradient"`), the same in both colour schemes. This
// file and chartColors.ts are the named homes for colour literals, so src/architecture/styles.test.ts
// does not count them (AGENTS.md, Styling).

/** Sign in, password reset and the translation link: teal to blue. */
export const SIGN_IN_GRADIENT: MantineGradient = { from: "#43cea2", to: "#185a9d" };

/** Sign up and the first-run setup steps: amber to magenta. */
export const SIGN_UP_GRADIENT: MantineGradient = { from: "#D38312", to: "#A83279" };
