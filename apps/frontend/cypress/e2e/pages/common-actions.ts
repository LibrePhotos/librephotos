/// <reference types="cypress" />
/// <reference path="../../support/commands.ts" />

export abstract class CommonActions {
  abstract path: string;

  visit() {
    cy.visit(this.path);
  }

  abstract isActivePage();

  locationShouldBe(expectedLocation: string) {
    cy.location().should(location => {
      expect(location.pathname).to.eq(expectedLocation);
    });
  }

  pressButton(label: string) {
    cy.get("button > div.mantine-Button-inner > span.mantine-Button-label")
      .should("have.text", label)
      .parentsUntil("button")
      .click();
  }
}
