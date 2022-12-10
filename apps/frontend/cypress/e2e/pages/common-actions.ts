export class CommonActions {
  visit(path: string) {
    cy.visit(path);
  }

  locationShouldBe(expectedLocation: string) {
    cy.location().should(location => {
      expect(location.pathname).to.eq(expectedLocation);
    });
  }

  pressButton(label: string) {
    cy.get("button .mantine-Button-label").should("have.text", label).click();
  }
}
