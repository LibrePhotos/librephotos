import type { DateTimeRule } from "../../../src/components/settings/date-time.zod";
import { userDefaults } from "../fixtures/user_defaults";
import { CommonActions } from "./common-actions";

enum PropTypes {
  SELECT,
  INPUT,
  SWITCH,
  RADIO,
}

export class UserSettingsPage extends CommonActions {
  path = "/settings";

  properties = {
    "Scene Confidence": PropTypes.RADIO,
    "Semantic Search Max Results": PropTypes.RADIO,
    "Synchronize metadata to disk": PropTypes.RADIO,
    "Minimum image rating to interpret as favorite": PropTypes.RADIO,
    "Default timezone": PropTypes.SELECT,
    "Inferred faces confidence": PropTypes.INPUT,
    "Always transcode videos": PropTypes.SWITCH,
  };

  defaultDateTimeRules: DateTimeRule[] = JSON.parse(userDefaults.datetime_rules).filter(rule => rule.is_default);

  isActivePage() {
    cy.get("h1").should("have.text", "Settings").wait(500);
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

      case PropTypes.RADIO:
        cy.selectRadio(label, value);
        break;

      default:
        throw new Error("Unknown property type");
    }
  }

  notificationIsVisible() {}

  propertyHasValue(label: string, value: string) {
    switch (this.properties[label]) {
      case PropTypes.SELECT:
      case PropTypes.INPUT:
        cy.get("label").contains(label).parent().find("input").should("have.value", value);
        break;

      case PropTypes.SWITCH:
        cy.get("label")
          .contains(label)
          .parent()
          .parent()
          .find("input")
          .should(value === "on" ? "be.checked" : "not.be.checked");
        break;

      case PropTypes.RADIO:
        cy.get("div.mantine-RadioGroup-label")
          .contains(label)
          .siblings()
          .find("label")
          .contains(value)
          .parent()
          .parent()
          .find("input")
          .should("be.checked");
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

  deleteRule(id: number) {
    cy.get("table > tbody")
      .find("strong")
      .contains(`(ID:${id})`)
      .parentsUntil("tr")
      .parent()
      .find(`button[title="Delete rule"]`)
      .click();
  }

  shouldNotContainRule(id: number) {
    cy.get("table > tbody").find("strong").contains(`(ID:${id})`).should("not.exist");
  }

  shouldContainRule(id: number) {
    cy.get("table > tbody").find("strong").contains(`(ID:${id})`).should("exist");
  }

  defaultDateTimeRulesDisplayedCorrectly() {
    cy.get("h4")
      .contains("Set date & time parsing rules")
      .parent()
      .within(() => {
        this.defaultDateTimeRules.forEach((rule, index) => this.expectedRuleAtIndex(index, rule.id));
      });
  }

  private expectedRuleAtIndex(index: number, id: number) {
    const rule = this.defaultDateTimeRules.find(r => r.id === id)!;
    const ignoreRuleProps = ["name", "id", "rule_type", "transform_tz", "is_default"];

    cy.get("table > tbody > tr")
      .eq(index)
      .children()
      .first()
      .within(() => {
        cy.get("strong").should("contain.text", rule.name);
        cy.get("div").should("contain.text", `Rule Type: ${rule.rule_type}`);

        /**
         * Checking for extra props that **should** be present programmatically is difficult because of labels are translated
         * Let's assume for now that they are displayed correctly :)
         * Instead, let's check for props that should not be displayed (which is easier as they are not translated)
         */
        ignoreRuleProps.forEach(prop => {
          cy.get("div").should("not.contain.text", `${prop}:`);
        });
      });
  }
}
