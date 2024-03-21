import { CommonActions } from "./common-actions";

export class PhotoListPage extends CommonActions {
  path = "/";

  isActivePage() {
    this.locationShouldBe(this.path);
    // TODO(sickelap): add more checks to ensure we are on photo list page
  }
}
