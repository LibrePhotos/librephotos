import { CommonActions } from "./common-actions";

export class HeaderPageObject extends CommonActions {
  path = "";

  clickProfile() {
    cy.get("img.mantine-Avatar-image").parentsUntil(".mantine-Group-root").first().click();
  }

  clickMenu(label: string) {
    cy.get("div").contains(label).parentsUntil(".mantine-Menu-item").first().click();
  }

  isActivePage() {
    return true;
  }
}
