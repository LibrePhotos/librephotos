import { Then, When } from "@badeball/cypress-cucumber-preprocessor";

import { LoginPage } from "../pages/login-page";

const loginPage = new LoginPage();

Then(/^I am on login screen$/, () => {
  loginPage.isCurrent();
});

When(/^I enter "([^"]*)" to username field$/, (username: string) => {
  loginPage.enterUsername(username);
});

When(/^I enter "([^"]*)" to password field$/, (password: string) => {
  loginPage.enterPassword(password);
});
