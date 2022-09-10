import { createSelector } from "@reduxjs/toolkit";

import type { RootState } from "../store";
import { selectSelf } from "../store";

export const selectFaces = createSelector(selectSelf, (state: RootState) => state.faces);
