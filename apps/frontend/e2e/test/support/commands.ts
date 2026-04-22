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
  // first find the input that belongs to the label
  cy.get("label")
    .contains(label)
    .parentsUntil(".mantine-Switch-root")
    .find(selector)
    // then go back again to the checkbox element root and click the label
    .parentsUntil(".mantine-Switch-root")
    .find("label")
    .contains(label)
    .click()
    .wait(500);
});

Cypress.Commands.add("selectRadio", (label: string, value: string) => {
  cy.get("div.mantine-RadioGroup-label").contains(label).parent().find("label").contains(value).click().wait(500);
});

declare global {
  namespace Cypress {
    interface Chainable {
      selectOption(label: string, value: string): Chainable<Element>;

      enterInputValue(label: string, value: string): Chainable<Element>;

      switch(label: string, state: "on" | "off"): Chainable<Element>;

      selectRadio(label: string, value: string): Chainable<Element>;
    }
  }
}

export {};
