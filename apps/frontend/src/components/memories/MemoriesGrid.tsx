import type { Memory } from "@librephotos/api-client";
import React from "react";
import classes from "./MemoriesGrid.module.css";
import { MemoryCard } from "./MemoryCard";

type Props = Readonly<{
  memories: readonly Memory[];
  onPlay: (memory: Memory) => void;
}>;

// About a card's width, for its cover's size attributes; the grid sizes the cards
const CARD_WIDTH = 300;

/**
 * The memories page's story cards, as many columns as fit at about 260px or more, so the cards
 * fill the page's width. One memory per year: a plain list, nothing to virtualize.
 */
export function MemoriesGrid({ memories, onPlay }: Props) {
  return (
    <div className={classes.grid}>
      {memories.map(memory => (
        <MemoryCard key={memory.id} memory={memory} size={CARD_WIDTH} onPlay={() => onPlay(memory)} />
      ))}
    </div>
  );
}
