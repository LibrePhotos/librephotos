import { Memory } from "../../api_client/memories";
import { PigPhoto } from "../../api_client/photos/types";

/**
 * Turning memories into the shapes the shared photo list wants.
 *
 * The gallery reuses PhotoListView, which groups a timeline by day: each memory
 * is one such group, in the order the tiles show them (nearest year first).
 */
export function memoriesToPhotoGroups(memories: Memory[]) {
  return memories.map(memory => ({
    id: memory.id,
    date: memory.date,
    location: memory.location,
    // Deliberately the number of items in hand rather than `numberOfItems`:
    // a group that claims more than it carries makes the grid reserve space
    // for photos that were never sent.
    numberOfItems: memory.items.length,
    incomplete: false,
    items: memory.items,
  }));
}

/** Every photo on show, in memory order -- what "play all" plays. */
export function memoriesToFlatItems(memories: Memory[]): PigPhoto[] {
  return memories.flatMap(memory => memory.items);
}

/** How many photos the day holds, which is not always how many were sent. */
export function memoriesPhotoCount(memories: Memory[]): number {
  return memories.reduce((total, memory) => total + memory.numberOfItems, 0);
}

/** True when a memory holds more photos than the backend returned. */
export function memoriesAreCapped(memories: Memory[]): boolean {
  return memories.some(memory => memory.items.length < memory.numberOfItems);
}
