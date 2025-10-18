import { FC } from "react";
import { AutoSizer as _AutoSizer, Grid as _Grid, AutoSizerProps, GridProps } from "react-virtualized";

export const AutoSizer = _AutoSizer as unknown as FC<AutoSizerProps>;
export type AutoSizer = _AutoSizer;

export const Grid = _Grid as unknown as FC<GridProps>;
export type Grid = _Grid;
