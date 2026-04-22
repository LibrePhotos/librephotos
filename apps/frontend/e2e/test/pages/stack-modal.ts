/* eslint-disable class-methods-use-this */

/**
 * Page object for the Stack Detail Modal.
 */
export class StackModal {
  isOpen() {
    cy.get(".mantine-Modal-root").should("be.visible");
  }

  isClosed() {
    cy.get(".mantine-Modal-root").should("not.exist");
  }

  getTitle() {
    return cy.get(".mantine-Modal-title");
  }

  getPhotos() {
    return cy.get(".mantine-Modal-body .mantine-Card-root");
  }

  getPrimaryPhoto() {
    return cy.get(".mantine-Modal-body .mantine-Card-root").filter(':contains("Primary")');
  }

  selectPhotoAsPrimary(index = 0) {
    this.getPhotos().eq(index).find("button").contains("Set as Cover").click();
  }

  isPrimaryPhoto(index = 0) {
    this.getPhotos().eq(index).should("contain.text", "Primary");
  }

  clickExpandPhoto(index = 0) {
    this.getPhotos().eq(index).find('button[aria-label*="expand"], button svg').click();
  }

  clickClose() {
    cy.get(".mantine-Modal-body button").contains("Close").click();
  }

  // Assertions
  shouldHaveMultiplePhotos() {
    this.getPhotos().should("have.length.at.least", 2);
  }

  shouldShowPrimaryIndicator() {
    cy.get(".mantine-Modal-body").should("contain.text", "Primary");
  }

  shouldShowStackType() {
    cy.get(".mantine-Modal-title").should("match", /RAW\+JPEG|Burst|Bracket|Live Photo|Manual/);
  }
}
