/* global jest */
/**
 * Manual mock for `@expo/vector-icons` (auto-applied: node-module manual mocks
 * need no `jest.mock()` call).
 *
 * The real package pulls in `expo-font` → `expo-asset`, and npm nests
 * `expo-asset` inside `node_modules/expo/node_modules/`, where jest's resolver
 * (walking up from `node_modules/expo-font/`) cannot see it. Metro resolves it
 * fine, so this is a test-environment-only gap — the icon fonts themselves are
 * bundled in Expo Go and work on device.
 *
 * Each icon renders an empty `View` carrying `testID="icon-<name>"`, so tests
 * can assert an icon is present without the glyph text polluting `getByText`.
 */
const React = require("react");
const { View } = require("react-native");

function makeIconSet(family) {
  const IconSet = ({ name, testID, ...rest }) =>
    React.createElement(View, { testID: testID ?? `icon-${name}`, ...rest });
  IconSet.displayName = family;
  IconSet.Button = IconSet;
  IconSet.font = {};
  IconSet.loadFont = jest.fn(async () => {});
  return IconSet;
}

const FAMILIES = [
  "AntDesign",
  "Entypo",
  "EvilIcons",
  "Feather",
  "FontAwesome",
  "FontAwesome5",
  "FontAwesome6",
  "Fontisto",
  "Foundation",
  "Ionicons",
  "MaterialCommunityIcons",
  "MaterialIcons",
  "Octicons",
  "SimpleLineIcons",
  "Zocial",
];

const mock = { createIconSet: () => makeIconSet("Custom"), createIconSetFromIcoMoon: () => makeIconSet("Custom") };
for (const family of FAMILIES) mock[family] = makeIconSet(family);

module.exports = mock;
