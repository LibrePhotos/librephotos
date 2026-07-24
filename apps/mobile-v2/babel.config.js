/**
 * Babel config for Expo SDK 54 (New Architecture) + NativeWind v4.
 *
 * NativeWind's transform (jsxImportSource + nativewind/babel) injects a
 * `_ReactNativeCSSInterop` module helper that collides with jest.mock hoisting.
 * The app styles via style props + theme (not `className`), so NativeWind is not
 * needed under jest — we disable it in the test env and keep it for real builds.
 */
module.exports = function (api) {
  const isTest = api.env("test");
  api.cache.using(() => process.env.NODE_ENV ?? "development");
  return {
    presets: [
      ["babel-preset-expo", isTest ? {} : { jsxImportSource: "nativewind" }],
      ...(isTest ? [] : ["nativewind/babel"]),
    ],
  };
};
