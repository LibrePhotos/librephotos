const { defineConfig } = require("cypress");
const { addCucumberPreprocessorPlugin } = require("@badeball/cypress-cucumber-preprocessor");
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

/* eslint-disable-next-line import/no-default-export */
export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:8080",
    setupNodeEvents,
    specPattern: "**/*.feature",
    supportFile: false,
    video: false,
    viewportWidth: 1024,
    viewportHeight: 768,
  },
});
