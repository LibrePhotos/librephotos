import { CommonActions } from "./common-actions";

export class PhotoListPage {
  path = "/";

  common: CommonActions;

  constructor() {
    this.common = new CommonActions();
  }

  visit() {
    this.common.visit(this.path);
  }

  isCurrent() {
    this.common.locationShouldBe(this.path);
    // TODO(sickelap): add more checks to ensure we are on photo list page
  }
}
