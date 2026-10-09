/// <reference types="jest" />

/*
 * The globals jest.setup.js reads or installs, typed so a test sets them as
 * properties of `globalThis` instead of casting it. Outside jest none of them
 * exist, hence `| undefined` on every one.
 */

/** Read by the expo-network mock: the connectivity a screen sees (default online). */
declare var __mockNetworkConnected: boolean | undefined;

/** Returned by the expo-router mock's `useLocalSearchParams` (default `{}`). */
declare var __mockSearchParams: Record<string, string | string[]> | undefined;

/** Returned by the expo-router mock's `router.canGoBack()` (default true). */
declare var __mockCanGoBack: boolean | undefined;

/** The router the expo-router mock's `useRouter` hands every screen. */
declare var __mockRouter:
  | {
      push: jest.Mock<void, unknown[], unknown>;
      replace: jest.Mock<void, unknown[], unknown>;
      back: jest.Mock<void, [], unknown>;
      canGoBack: jest.Mock<boolean, [], unknown>;
      dismissTo: jest.Mock<void, unknown[], unknown>;
      navigate: jest.Mock<void, unknown[], unknown>;
    }
  | undefined;
