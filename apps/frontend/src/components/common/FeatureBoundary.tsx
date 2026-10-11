import { Button, Center, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

type FallbackProps = Readonly<{
  error: unknown;
  reset: () => void;
}>;

type FeatureBoundaryProps = Readonly<{
  children: React.ReactNode;
  /** Names the feature in the console log, e.g. "lightbox" or "map". */
  name: string;
  /** When any of these change, a failed boundary renders its children again. */
  resetKeys?: readonly unknown[];
  /** Replaces the inline fallback, for a feature that needs its own frame (the lightbox's dialog). */
  fallback?: (props: FallbackProps) => React.ReactNode;
}>;

type FeatureBoundaryState = { error: unknown; failed: boolean };

/** The inline fallback: what failed and a Retry that renders the feature again. */
export function FeatureFallback({ reset }: Readonly<{ reset: () => void }>) {
  const { t } = useTranslation();
  return (
    <Center py="md" role="alert">
      <Stack align="center" gap="xs">
        <IconAlertTriangle size={24} color="var(--mantine-color-orange-6)" />
        <Text size="sm" c="dimmed" ta="center">
          {t("featureboundary.title")}
        </Text>
        <Button size="xs" variant="light" onClick={reset}>
          {t("featureboundary.retry")}
        </Button>
      </Stack>
    </Center>
  );
}

function keysChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (previous === next) return false;
  if (!previous || !next || previous.length !== next.length) return true;
  return previous.some((key, index) => !Object.is(key, next[index]));
}

/**
 * Keeps a render error in one feature (the lightbox, a map, a chart) from
 * replacing the whole page with the route error screen. It goes inside the
 * shared component that wraps the third-party renderer, not at each call site.
 * React 19 still needs a class component to catch render errors.
 */
export class FeatureBoundary extends React.Component<FeatureBoundaryProps, FeatureBoundaryState> {
  override state: FeatureBoundaryState = { error: undefined, failed: false };

  static getDerivedStateFromError(error: unknown): FeatureBoundaryState {
    return { error, failed: true };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error(`[FeatureBoundary:${this.props.name}]`, error, info.componentStack);
  }

  override componentDidUpdate(previous: FeatureBoundaryProps): void {
    if (this.state.failed && keysChanged(previous.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: undefined, failed: false });
  };

  override render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ error: this.state.error, reset: this.reset });
    return <FeatureFallback reset={this.reset} />;
  }
}
