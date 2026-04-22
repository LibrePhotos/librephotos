/* eslint-disable class-methods-use-this */
import { userDefaults } from "../fixtures/user_defaults";
import i18n from "../support/i18n.json";
import { CommonActions } from "./common-actions";

enum PropTypes {
  SELECT,
  INPUT,
  SWITCH,
  RADIO,
}

export class UserSettingsPage extends CommonActions {
  path = "/settings";

  properties = {};

  defaultDateTimeRules: any[] = JSON.parse(userDefaults.datetime_rules).filter(rule => rule.is_default);

  constructor() {
    super();
    this.populateProperties();
  }

  isActivePage() {
    cy.get("h1").should("have.text", i18n.settings.header).wait(500);
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
        console.error(label, this.properties[label]);
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
          .parentsUntil(".mantine-Switch-root")
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
    cy.get(".mantine-Dialog-root span").contains(i18n.settings.favoriteupdate).parentsUntil("button").click();
  }

  cancelChanges() {
    cy.get(".mantine-Dialog-root span").contains(i18n.settings.nextcloudcancel).parentsUntil("button").click();
  }

  resetSettingsToDefaults() {
    /**
     * Yep, nesting looks ugly. Hope sometime we will have a better way of doing this.
     * The order of next two requests isn't important. The goal is to obtain user id to be updated and jwt for the
     * update request.
     */
    const auth = Cypress.env("users").admin;
    cy.request({ url: "/api/user/", auth }).then(response => {
      cy.request({
        method: "PATCH",
        url: `/api/user/${response.body.results[0].id}/`,
        body: userDefaults,
        auth,
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
      .contains(i18n.settings.configdatetime)
      .parent()
      .within(() => {
        this.defaultDateTimeRules.forEach((rule, index) => this.expectedRuleAtIndex(index, rule.id));
      });
  }

  private expectedRuleAtIndex(index: number, id: number) {
    const rule = this.defaultDateTimeRules.find(r => r.id === id)!;
    const ignoreRuleProps = ["name", "id", "rule_type", "transform_tz", "is_default"];
    const expectedLabel = `${i18n.rules.rule_type.replace("{{rule}}", rule.rule_type)}`;

    cy.get("table > tbody > tr")
      .eq(index)
      .children()
      .first()
      .within(() => {
        cy.get("strong").should("contain.text", rule.name);
        cy.get("div").should("contain.text", expectedLabel);

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

  private populateProperties() {
    this.properties[i18n.settings.sceneconfidence] = PropTypes.RADIO;
    this.properties[i18n.settings.semanticsearchheader] = PropTypes.RADIO;
    this.properties[i18n.settings.sync] = PropTypes.RADIO;
    this.properties[i18n.settings.favoriteminimum] = PropTypes.RADIO;
    this.properties[i18n.defaulttimezone] = PropTypes.SELECT;
    this.properties[i18n.settings.inferredfacesconfidence] = PropTypes.INPUT;
    this.properties[i18n.settings.transcodevideo] = PropTypes.SWITCH;
  }
}
