/* global jest */
// Test environment shims for native modules the screens touch indirectly.

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

// expo-clipboard → capture copied strings in tests.
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ""),
}));

// expo-image → a plain RN Image-like stub exposing testID/source.
jest.mock("expo-image", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Image: props => React.createElement(View, props) };
});

// expo-router → capture navigation without a router provider.
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => globalThis.__mockSearchParams ?? {},
  Link: ({ children }) => children,
  Stack: Object.assign(() => null, { Screen: () => null, Protected: () => null }),
  Tabs: Object.assign(() => null, { Screen: () => null }),
}));
globalThis.__mockRouter = mockRouter;
