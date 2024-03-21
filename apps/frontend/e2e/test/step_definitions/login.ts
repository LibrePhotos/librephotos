import { Given, Then, When } from "@badeball/cypress-cucumber-preprocessor";

import { LoginPage } from "../pages/login-page";

const loginPage = new LoginPage();

Then(/^I am on login screen$/, () => loginPage.isActivePage());

When(/^I enter "([^"]*)" to username field$/, (username: string) => loginPage.enterUsername(username));

When(/^I enter "([^"]*)" to password field$/, (password: string) => loginPage.enterPassword(password));

Given(/^I am logged in as admin$/, () => loginPage.login("admin", "admin"));

When(/^I click Login button$/, () => loginPage.clickLoginButton());

Given(/^I navigate to login page$/, () => loginPage.visit());
