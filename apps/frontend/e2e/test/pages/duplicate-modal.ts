/* eslint-disable class-methods-use-this */

/**
 * Page object for the Duplicate Detail Modal.
 */
export class DuplicateModal {
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

  selectPhoto(index = 0) {
    this.getPhotos().eq(index).find("button").contains("Select").click();
  }

  selectPhotoByPosition(position: number) {
    this.getPhotos().eq(position).find("button").contains("Select").click();
  }

  isPhotoSelected(index = 0) {
    this.getPhotos().eq(index).find("button").contains("Keep This").should("exist");
  }

  getPhotoResolution(index = 0) {
    return this.getPhotos().eq(index).find("span").first();
  }

  getPhotoFileSize(index = 0) {
    return this.getPhotos().eq(index).find(".mantine-Badge-root").first();
  }

  clickKeepAndTrash() {
    cy.get(".mantine-Modal-body button").contains("Keep Selected & Trash Others").click();
  }

  clickNotADuplicate() {
    cy.get(".mantine-Modal-body button").contains("Not a Duplicate").click();
  }

  clickRevertAndRestore() {
    cy.get(".mantine-Modal-body button").contains("Revert & Restore Photos").click();
  }

  clickCancel() {
    cy.get(".mantine-Modal-body button").contains("Cancel").click();
  }

  clickClose() {
    cy.get(".mantine-Modal-body button").contains("Close").click();
  }

  clickExpandPhoto(index = 0) {
    this.getPhotos().eq(index).find('button[aria-label*="expand"], button svg').click();
  }

  // Assertions
  shouldShowRevertButton() {
    cy.get(".mantine-Modal-body button").contains("Revert & Restore Photos").should("be.visible");
  }

  shouldShowResolveButtons() {
    cy.get(".mantine-Modal-body button").contains("Keep Selected & Trash Others").should("be.visible");
    cy.get(".mantine-Modal-body button").contains("Not a Duplicate").should("be.visible");
  }

  shouldHaveMultiplePhotos() {
    this.getPhotos().should("have.length.at.least", 2);
  }

  shouldShowPhotoInfo() {
    // Check for resolution info (e.g., "1920 × 1080")
    cy.get(".mantine-Modal-body").should("contain.text", "×");
    // Check for file size info (e.g., "1.5 MB")
    cy.get(".mantine-Modal-body .mantine-Badge-root").should("exist");
  }

  shouldShowSimilarityScore() {
    cy.get(".mantine-Modal-body").should("contain.text", "% similar");
  }
}
