import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "../store";

const selectSelf = (state: RootState): RootState => state;
export const selectUserSelfDetails = createSelector(selectSelf, (state: RootState) => state.user.userSelfDetails);
