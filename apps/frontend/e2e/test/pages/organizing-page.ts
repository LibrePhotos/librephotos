/* eslint-disable class-methods-use-this */
import { CommonActions } from "./common-actions";

/**
 * Page object for the Organizing page (duplicates and stacks tabs).
 */
export class OrganizingPage extends CommonActions {
  path = "/organizing/duplicates";

  isActivePage() {
    cy.get("h2").should("contain.text", "Organizing");
  }

  // Navigation
  clickDuplicatesTab() {
    cy.get('[role="tab"]').contains("Duplicates").click();
    cy.wait(500);
  }

  clickStacksTab() {
    cy.get('[role="tab"]').contains("Stacks").click();
    cy.wait(500);
  }

  isDuplicatesTabActive() {
    cy.get('[role="tab"][aria-selected="true"]').should("contain.text", "Duplicates");
  }

  isStacksTabActive() {
    cy.get('[role="tab"][aria-selected="true"]').should("contain.text", "Stacks");
  }

  // Duplicates Actions
  clickFindDuplicatesButton() {
    cy.get("button").contains("Find Duplicates").click();
  }

  clickDetectStacksButton() {
    cy.get("button").contains("Detect Stacks").click();
  }

  isDetectionInProgress() {
    cy.get("button").contains("Find Duplicates").should("have.attr", "data-loading", "true");
  }

  isStackDetectionInProgress() {
    cy.get("button").contains("Detect Stacks").should("have.attr", "data-loading", "true");
  }

  waitForDetectionComplete(timeout = 30000) {
    cy.get("button").contains("Find Duplicates", { timeout }).should("not.have.attr", "data-loading", "true");
  }

  waitForStackDetectionComplete(timeout = 30000) {
    cy.get("button").contains("Detect Stacks", { timeout }).should("not.have.attr", "data-loading", "true");
  }

  // Filters
  filterByStatus(status: "pending" | "resolved" | "dismissed" | "") {
    cy.get(".mantine-SegmentedControl-root")
      .first()
      .within(() => {
        const label = status === "" ? "All" : status.charAt(0).toUpperCase() + status.slice(1);
        cy.get(`input[value="${status}"]`).parent().click();
      });
    cy.wait(300);
  }

  filterByType(type: string) {
    // Click the type filter dropdown
    cy.get("button").contains(/All Types|Exact Copies|Visual Duplicates/).click();
    cy.get(".mantine-Menu-dropdown").contains(type).click();
    cy.wait(300);
  }

  filterStacksByType(type: string) {
    cy.get("button").contains(/All Types|RAW\+JPEG|Burst|Bracket|Live Photo|Manual/).click();
    cy.get(".mantine-Menu-dropdown").contains(type).click();
    cy.wait(300);
  }

  // Duplicate Cards
  getDuplicateCards() {
    return cy.get('[data-testid="duplicate-card"]');
  }

  getStackCards() {
    return cy.get('[data-testid="stack-card"]');
  }

  clickFirstDuplicateCard() {
    cy.get(".mantine-Card-root").first().click();
  }

  clickFirstStackCard() {
    cy.get(".mantine-Card-root").first().click();
  }

  openContextMenuOnFirstCard() {
    cy.get(".mantine-Card-root").first().find("button").filter('[aria-label*="menu"]').click();
  }

  // Selection
  checkSelectAll() {
    cy.get('input[type="checkbox"]').contains("Select All").parent().click();
  }

  isAllSelected() {
    cy.get('input[type="checkbox"]').first().should("be.checked");
  }

  clickDeleteSelected() {
    cy.get("button").contains("Delete Selected").click();
  }

  clickClearSelection() {
    cy.get("button").contains("Clear Selection").click();
  }

  // Detection Options
  openDetectionOptionsMenu() {
    cy.get("button").contains("Detection Options").click();
  }

  toggleExactCopies(checked: boolean) {
    const checkbox = cy.get('input[type="checkbox"]').filter((index, el) => {
      return el.closest("label")?.textContent?.includes("Exact file copies") ?? false;
    });
    if (checked) {
      checkbox.check();
    } else {
      checkbox.uncheck();
    }
  }

  toggleVisualDuplicates(checked: boolean) {
    const checkbox = cy.get('input[type="checkbox"]').filter((index, el) => {
      return el.closest("label")?.textContent?.includes("Visual duplicates") ?? false;
    });
    if (checked) {
      checkbox.check();
    } else {
      checkbox.uncheck();
    }
  }

  selectSensitivity(sensitivity: "strict" | "normal" | "loose") {
    cy.get(".mantine-SegmentedControl-root")
      .contains(sensitivity.charAt(0).toUpperCase() + sensitivity.slice(1))
      .click();
  }

  // Assertions for filtered content
  shouldOnlyShowPendingDuplicates() {
    cy.get(".mantine-Badge-root").contains("Pending").should("exist");
    cy.get(".mantine-Badge-root").contains("Resolved").should("not.exist");
    cy.get(".mantine-Badge-root").contains("Dismissed").should("not.exist");
  }

  shouldOnlyShowResolvedDuplicates() {
    cy.get(".mantine-Badge-root").contains("Resolved").should("exist");
  }

  shouldOnlyShowExactCopies() {
    cy.get(".mantine-Badge-root").contains("Exact").should("exist");
  }

  shouldOnlyShowVisualDuplicates() {
    cy.get(".mantine-Badge-root").contains("Visual").should("exist");
  }

  shouldShowNoDuplicatesMessage() {
    cy.get("body").should("contain.text", "No duplicates found");
  }
}
