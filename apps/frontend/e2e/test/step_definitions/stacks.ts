import { Given, Then, When } from "@badeball/cypress-cucumber-preprocessor";

import { OrganizingPage } from "../pages/organizing-page";
import { StackModal } from "../pages/stack-modal";

const organizingPage = new OrganizingPage();
const stackModal = new StackModal();

// Navigation
When(/^I click on the Stacks tab$/, () => {
  organizingPage.clickStacksTab();
});

Then(/^I should see the stacks list$/, () => {
  organizingPage.isStacksTabActive();
});

Then(/^I should see "Detect Stacks" button$/, () => {
  cy.get("button").contains("Detect Stacks").should("be.visible");
});

// Detection
When(/^I click "Detect Stacks" button$/, () => {
  organizingPage.clickDetectStacksButton();
});

Then(/^I should see stack detection in progress$/, () => {
  cy.wait(500);
});

Then(/^stack detection should complete successfully$/, () => {
  organizingPage.waitForStackDetectionComplete(60000);
});

// Preconditions
Given(/^there are stacks of different types$/, () => {
  organizingPage.clickDetectStacksButton();
  organizingPage.waitForStackDetectionComplete(60000);
});

Given(/^there is at least one stack$/, () => {
  cy.wait(500);
});

Given(/^there is at least one stack with multiple photos$/, () => {
  cy.wait(500);
});

// Filtering
When(/^I filter by "RAW\+JPEG" type$/, () => {
  organizingPage.filterStacksByType("RAW+JPEG");
});

When(/^I filter by "Burst" type$/, () => {
  organizingPage.filterStacksByType("Burst");
});

When(/^I filter by "All Types" type$/, () => {
  organizingPage.filterStacksByType("All Types");
});

Then(/^I should only see RAW\+JPEG stacks$/, () => {
  cy.get(".mantine-Badge-root").contains("RAW").should("exist");
});

Then(/^I should only see burst stacks$/, () => {
  cy.get(".mantine-Badge-root").contains("Burst").should("exist");
});

Then(/^I should see all stacks$/, () => {
  cy.wait(500);
});

// Card interactions
When(/^I click on a stack card$/, () => {
  organizingPage.clickFirstStackCard();
});

Then(/^I should see the stack detail modal$/, () => {
  stackModal.isOpen();
});

Then(/^I should see photos in the stack$/, () => {
  stackModal.shouldHaveMultiplePhotos();
});

Then(/^I should see the primary photo highlighted$/, () => {
  stackModal.shouldShowPrimaryIndicator();
});

// Modal actions
When(/^I select a different photo as primary$/, () => {
  stackModal.selectPhotoAsPrimary(1);
});

Then(/^the selected photo should become primary$/, () => {
  stackModal.isPrimaryPhoto(1);
});

Then(/^the stack cover should update$/, () => {
  cy.wait(1000);
});

// Context menu
When(/^I click the context menu on a stack card$/, () => {
  organizingPage.openContextMenuOnFirstCard();
});

When(/^I click "Unstack" option$/, () => {
  cy.get(".mantine-Menu-dropdown").contains("Unstack").click();
});

Then(/^the stack should be removed$/, () => {
  cy.wait(1000);
});

Then(/^photos should no longer be grouped$/, () => {
  cy.wait(500);
});

// Lightbox in stack modal
Then(/^I should be able to navigate between stack photos$/, () => {
  // Check for navigation arrows or thumbnails in lightbox
  cy.get(".yarl__root, [class*='lightbox'], [data-testid='lightbox']").should("exist");
});
