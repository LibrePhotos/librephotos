/* global jest */
// Test environment shims for native modules the screens touch indirectly.

// Async-assertion headroom. Several screens debounce real timers (e.g. the
// search input debounces 300ms via setTimeout, not fake timers) and then run a
// SQL query before rendering. RNTL's default `waitFor` window is 1000ms, which
// leaves ~700ms — enough on an idle machine, but jest runs ~40 suites across
// parallel workers, and a starved worker blows that budget. That produced
// order-dependent failures that passed in isolation. Widening the window keeps
// every assertion intact (they must still become true) and removes the race.
// Per-test timeout must exceed asyncUtilTimeout or the test aborts first.
require("@testing-library/react-native").configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

// expo-secure-store: an in-memory store so token-backed code paths run in Node.
jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async key => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async key => {
      store.delete(key);
    }),
    __reset: () => store.clear(),
  };
});

// FlashList → render as a plain list so item output is assertable in RNTL.
jest.mock("@shopify/flash-list", () => {
  const React = require("react");
  const { View } = require("react-native");
  const asNode = (C) => (C == null ? null : React.isValidElement(C) ? C : React.createElement(C));
  const FlashList = ({ data = [], renderItem, ListEmptyComponent, ListHeaderComponent, testID }) => {
    const header = asNode(ListHeaderComponent);
    if (data.length === 0) {
      return React.createElement(View, { testID }, header, asNode(ListEmptyComponent));
    }
    return React.createElement(
      View,
      { testID },
      header,
      data.map((item, index) =>
        React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))
      )
    );
  };
  return { FlashList, MasonryFlashList: FlashList };
});

// expo-network → connectivity flag (default connected; override via global).
jest.mock("expo-network", () => ({
  NetworkStateType: {
    NONE: "NONE",
    UNKNOWN: "UNKNOWN",
    CELLULAR: "CELLULAR",
    WIFI: "WIFI",
    ETHERNET: "ETHERNET",
    BLUETOOTH: "BLUETOOTH",
    WIMAX: "WIMAX",
    VPN: "VPN",
    OTHER: "OTHER",
  },
  getNetworkStateAsync: jest.fn(async () => ({
    type: "WIFI",
    isConnected: globalThis.__mockNetworkConnected ?? true,
    isInternetReachable: globalThis.__mockNetworkConnected ?? true,
  })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// expo-notifications → in-memory scheduler stub (permissions granted).
jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DAILY: "daily" },
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => "memories-daily"),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));

// expo-clipboard → capture copied strings in tests.
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ""),
}));

// expo-image → a plain RN Image-like stub exposing testID/source.
// `prefetch` is a real (static) part of the API: the viewer warms its
// neighbouring slides through it, and a missing function would throw.
jest.mock("expo-image", () => {
  const React = require("react");
  const { View } = require("react-native");
  const Image = props => React.createElement(View, props);
  Image.prefetch = jest.fn(async () => true);
  Image.clearDiskCache = jest.fn(async () => true);
  return { Image };
});

// expo-video → the player is native; stub it as a view plus an inert player so
// video slides render (and are assertable) without a decoder.
jest.mock("expo-video", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    useVideoPlayer: jest.fn((source, setup) => {
      const player = { loop: false, muted: false, play: jest.fn(), pause: jest.fn(), release: jest.fn() };
      setup?.(player);
      return player;
    }),
    VideoView: props => React.createElement(View, props),
  };
});

// expo-router → capture navigation without a router provider.
// `canGoBack` defaults to true (a screen reached by navigation); flip
// `globalThis.__mockCanGoBack = false` to exercise the deep-link / cold-start
// case where `router.back()` would throw.
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => globalThis.__mockCanGoBack ?? true),
  dismissTo: jest.fn(),
  navigate: jest.fn(),
};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => globalThis.__mockSearchParams ?? {},
  Redirect: () => null,
  Link: ({ children }) => children,
  Stack: Object.assign(() => null, { Screen: () => null, Protected: () => null }),
  Tabs: Object.assign(() => null, { Screen: () => null }),
}));
globalThis.__mockRouter = mockRouter;
