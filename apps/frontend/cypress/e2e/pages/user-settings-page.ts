import { userDefaults } from "../fixtures/user_defaults";
import { CommonActions } from "./common-actions";

enum PropTypes {
  SELECT,
  INPUT,
  SWITCH,
}

export class UserSettingsPage extends CommonActions {
  path = "/settings";

  properties = {
    "Scene Confidence": PropTypes.SELECT,
    "Semantic Search Max Results": PropTypes.SELECT,
    "Synchronize metadata to disk": PropTypes.SELECT,
    "Minimum image rating to interpret as favorite": PropTypes.SELECT,
    "Default timezone": PropTypes.SELECT,
    "Inferred faces confidence": PropTypes.INPUT,
    "Always transcode videos": PropTypes.SWITCH,
  };

  isActivePage() {
    cy.get("h2").should("have.text", "Settings");
  }

  changePropertyValue(label: string, value: string) {
    switch (this.properties[label]) {
      case PropTypes.SELECT:
        cy.selectOption(label, value);
        break;

      case PropTypes.INPUT:
        cy.enterInputValue(label, value);
        break;

      case PropTypes.SWITCH:
        cy.switch(label, value as any);
        break;

      default:
        throw new Error("Unknown property type");
    }
  }

  notificationIsVisible() {}

  propertyHasValue(label: string, value: string) {
    const root = cy.get("label").contains(label).parent();

    switch (this.properties[label]) {
      case PropTypes.SELECT:
      case PropTypes.INPUT:
        root.find("input").should("have.value", value);
        break;

      case PropTypes.SWITCH:
        root
          .parent()
          .find("input")
          .should(value === "checked" ? "be.checked" : "not.be.checked");
        break;

      default:
        throw new Error("Unknown property type");
    }
  }

  saveChanges() {
    cy.get(".mantine-Dialog-root span").contains("Update").parentsUntil("button").click();
  }

  cancelChanges() {
    cy.get(".mantine-Dialog-root span").contains("Cancel").parentsUntil("button").click();
  }

  resetSettingsToDefaults() {
    /**
     * Yep, nesting looks ugly. Hope sometime we will have a better way of doing this.
     * The order of next two requests isn't important. The goal is to obtain user id to be updated and jwt for the
     * update request.
     */
    cy.request("POST", "/api/auth/token/obtain/", { username: "admin", password: "admin" }).then(t => {
      cy.request("/api/user/").then(u => {
        cy.request({
          method: "PATCH",
          url: `/api/user/${u.body.results[0].id}/`,
          body: userDefaults,
          headers: { Authorization: `Bearer ${t.body.access}` },
        });
      });
    });
  }
}
