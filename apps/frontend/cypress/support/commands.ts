/// <reference types="cypress" />

Cypress.Commands.add("selectOption", (label: string, value: string) => {
  cy.get("label").contains(label).parent().find(".mantine-Select-wrapper").click();
  cy.get(".mantine-Select-itemsWrapper > div").contains(value).click();
});

Cypress.Commands.add("enterInputValue", (label: string, value: string) => {
  cy.get("label").contains(label).parent().find("input").clear().type(value).blur();
});

Cypress.Commands.add("switch", (label: string, state: "on" | "off") => {
  const selector = state === "on" ? `input[type="checkbox"]:not(:checked)` : `input[type="checkbox"]:checked`;
  cy.get("label").contains(label).parentsUntil(".mantine-Switch-root").find(selector).parent().click().wait(500);
});

declare global {
  namespace Cypress {
    interface Chainable {
      selectOption(label: string, value: string): Chainable<Element>;
      enterInputValue(label: string, value: string): Chainable<Element>;
      switch(label: string, state: "on" | "off"): Chainable<Element>;
    }
  }
}

export {};
