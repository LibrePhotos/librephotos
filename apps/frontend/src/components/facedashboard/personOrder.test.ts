import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { orderPeople } from "./personOrder";

const person = (name: string, faceCount: number, kind = "USER") => ({ name, kind, face_count: faceCount });

// As the server sends them: by name
const PEOPLE = [person("Anna", 3), person("Bob", 12), person("Carla", 3), person("Unknown 001", 40, "CLUSTER")];
// The backend sends its name as its kind
const UNKNOWN = person(UNKNOWN_PERSON_NAME, 500, UNKNOWN_PERSON_NAME);

const names = (people: readonly { name: string }[]) => people.map(p => p.name);

describe("orderPeople (#764)", () => {
  it("keeps the server's name order", () => {
    expect(names(orderPeople(PEOPLE, "name"))).toEqual(["Anna", "Bob", "Carla", "Unknown 001"]);
  });

  it("puts the people with the most faces first, by name among equal counts", () => {
    expect(names(orderPeople(PEOPLE, "count"))).toEqual(["Unknown 001", "Bob", "Anna", "Carla"]);
  });

  it("keeps Unknown - Other last in either order", () => {
    expect(names(orderPeople([UNKNOWN, ...PEOPLE], "count")).at(-1)).toBe(UNKNOWN_PERSON_NAME);
    expect(names(orderPeople([UNKNOWN, ...PEOPLE], "name")).at(-1)).toBe(UNKNOWN_PERSON_NAME);
  });

  it("sorts a copy and leaves the cached list as it was", () => {
    const cached = Object.freeze([...PEOPLE]);

    const ordered = orderPeople(cached, "count");

    expect(ordered).not.toBe(cached);
    expect(names(cached)).toEqual(["Anna", "Bob", "Carla", "Unknown 001"]);
  });
});
