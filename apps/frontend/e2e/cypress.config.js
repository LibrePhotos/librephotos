const { defineConfig } = require("cypress");
const { addCucumberPreprocessorPlugin } = require("@badeball/cypress-cucumber-preprocessor");
// eslint-disable-next-line import/no-unresolved
const browserify = require("@badeball/cypress-cucumber-preprocessor/browserify").preprocessor;

async function setupNodeEvents(on, config) {
  await addCucumberPreprocessorPlugin(on, config);
  on(
    "file:preprocessor",
    browserify(config, {
      typescript: require.resolve("typescript"),
    })
  );
  return config;
}

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:8080",
    setupNodeEvents,
    specPattern: "**/*.feature",
    supportFile: "test/support/e2e.ts",
    screenshotsFolder: "test/screenshots",
    viewportWidth: 1024,
    viewportHeight: 768,
    env: {
      users: {
        admin: { user: "admin", pass: "admin" },
      },
    },
  },
});
