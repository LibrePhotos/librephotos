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
  const FlashList = ({ data = [], renderItem, ListEmptyComponent, testID }) => {
    if (data.length === 0 && ListEmptyComponent) {
      const Empty = ListEmptyComponent;
      return React.isValidElement(Empty) ? Empty : React.createElement(Empty);
    }
    return React.createElement(
      View,
      { testID },
      data.map((item, index) =>
        React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))
      )
    );
  };
  return { FlashList, MasonryFlashList: FlashList };
});

// expo-image → a plain RN Image-like stub exposing testID/source.
jest.mock("expo-image", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Image: props => React.createElement(View, props) };
});
