import { CommonActions } from "./common-actions";

export class LoginPage {
  path = "/login";

  common: CommonActions;

  constructor() {
    this.common = new CommonActions();
  }

  visit() {
    this.common.visit(this.path);
  }

  isCurrent() {
    cy.location().should(location => {
      expect(location.pathname).to.eq(this.path);
    });
    cy.get("h3").should("contain.text", "Login");
  }

  enterUsername(username: string) {
    cy.get("form").within(() => {
      cy.get('input[type="text"]')
        .should("have.attr", "name", "username")
        .should("have.attr", "placeholder", "Username")
        .type(username);
    });
  }

  enterPassword(password: string) {
    cy.get("form").within(() => {
      cy.get('input[type="password"]')
        .should("have.attr", "name", "password")
        .should("have.attr", "placeholder", "Password")
        .type(password);
    });
  }

  loggedInAsAdmin() {
    this.visit();
    this.enterPassword("admin");
    this.enterUsername("admin");
    this.common.pressButton("Login");
  }
}
