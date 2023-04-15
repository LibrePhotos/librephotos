import { createSlice } from "@reduxjs/toolkit";

import type { PlayerState } from "./player.zod";

const initialState: PlayerState = {
  playing: false,
};

const playerSlice = createSlice({
  name: "player",
  initialState: initialState,
  reducers: {
    play: state => ({
      ...state,
      playing: true,
    }),
    pause: state => ({
      ...state,
      playing: false,
    }),
  },
});

export const { actions: playerActions, reducer: playerReducer } = playerSlice;
