/* eslint-disable class-methods-use-this */
import { CommonActions } from "./common-actions";

export class LoginPage extends CommonActions {
  path = "/login";

  isActivePage() {
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

  clickLoginButton() {
    this.pressButton("Login");
  }

  login(username: string, password: string) {
    this.visit();
    this.isActivePage();
    this.enterUsername(username);
    this.enterPassword(password);
    this.pressButton("Login");
  }
}
