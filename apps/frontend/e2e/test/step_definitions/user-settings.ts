import { Given, Then, When } from "@badeball/cypress-cucumber-preprocessor";
import type { DataTable } from "@badeball/cypress-cucumber-preprocessor";

import { HeaderPageObject } from "../pages/header.page-object";
import { UserSettingsPage } from "../pages/user-settings-page";

const userSettingsPage = new UserSettingsPage();
const header = new HeaderPageObject();

Given(/^I navigate to user settings$/, () => {
  header.clickProfile();
  header.clickMenu("Settings");
  userSettingsPage.isActivePage();
});

When(/^I change properties to:$/, (data: DataTable) => {
  const props = data.rowsHash();
  Object.keys(props).forEach(prop => {
    userSettingsPage.changePropertyValue(prop, props[prop]);
  });
});

Then(/^properties should be:$/, (data: DataTable) => {
  const props = data.rowsHash();
  Object.keys(props).forEach(prop => {
    userSettingsPage.propertyHasValue(prop, props[prop]);
  });
});

When(/^I save changes$/, () => userSettingsPage.saveChanges());

When(/^I cancel saving changes$/, () => userSettingsPage.cancelChanges());

Then(/^I should see update success notification$/, () => userSettingsPage.notificationIsVisible());

Given(/^user has default settings$/, () => userSettingsPage.resetSettingsToDefaults());

Then(/^I should see default date time rules displayed correctly$/, () =>
  userSettingsPage.defaultDateTimeRulesDisplayedCorrectly()
);

When(/^I delete rule with ID "([^"]*)"$/, (id: number) => userSettingsPage.deleteRule(id));

Then(/^date time rules should not contain rule with ID "([^"]*)"$/, (id: number) =>
  userSettingsPage.shouldNotContainRule(id)
);

Then(/^date time rules should contain rule with ID "([^"]*)"$/, (id: number) => userSettingsPage.shouldContainRule(id));
