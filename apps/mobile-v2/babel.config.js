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
    // Drizzle's generated `src/db/migrations/migrations.js` imports the `.sql`
    // files as modules. Metro resolves them (see `sourceExts` in
    // metro.config.js), but Babel would then parse SQL as JavaScript and throw
    // a TransformError, which breaks the app bundle. This plugin inlines each
    // `.sql` file as a string instead. Both are required — sourceExts alone is
    // not enough.
    plugins: [["inline-import", { extensions: [".sql"] }]],
  };
};
