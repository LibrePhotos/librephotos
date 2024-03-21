import { Given } from "@badeball/cypress-cucumber-preprocessor";

import { PhotoListPage } from "../pages/photo-list-page";

const photoListPage = new PhotoListPage();

Given("I should be on photo list page", () => photoListPage.isActivePage());
