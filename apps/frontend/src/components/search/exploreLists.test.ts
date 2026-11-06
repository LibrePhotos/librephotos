/**
 * What the Explore page (/search without words) shows: named people by face count, the most
 * specific places with one tile per cover, the biggest things; and which names the results' chips
 * match.
 */
import { UNKNOWN_PERSON_NAME, type PlaceAlbumInfo, type ThingAlbumInfo } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import type { Person } from "../../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import { displayLabel, explorePeople, explorePlaces, exploreThings, matchesTerm } from "./exploreLists";

const person = (id: string, name: string, face_count: number): Person => ({
  id,
  name,
  face_count,
  video: false,
  face_photo_url: "",
  face_url: "",
  group_ids: [],
  birth_date: null,
});

const place = (id: number, title: string, level: number, count: number, cover: string): PlaceAlbumInfo => ({
  id,
  title,
  geolocation_level: level,
  photo_count: count,
  cover_photos: [{ image_hash: cover, video: false }],
});

const thing = (id: number, title: string, count: number): ThingAlbumInfo => ({
  id,
  title,
  photo_count: count,
  thing_type: null,
  cover_photos: [],
});

describe("explorePeople", () => {
  it("leaves out the unknown group and people without faces, most faces first", () => {
    const people = [
      person("1", "Ada", 3),
      person("2", UNKNOWN_PERSON_NAME, 90),
      person("3", "Bo", 12),
      person("4", "Cy", 0),
    ];
    expect(explorePeople(people).map(p => p.name)).toEqual(["Bo", "Ada"]);
  });
});

describe("explorePlaces", () => {
  const places = [
    place(1, "Germany", 1, 47, "a"),
    place(2, "State of Berlin", 2, 41, "b"),
    place(3, "Berlin", 3, 41, "b"),
    place(4, "Brandenburg", 2, 6, "c"),
    place(5, "Potsdam", 3, 6, "c"),
    place(6, "Lisbon", 2, 5, "d"),
    place(7, "Tromsø", 3, 4, "e"),
    place(8, "Milan", 4, 3, "f"),
    place(9, "Toronto", 3, 2, "g"),
    place(10, "Paris", 3, 1, "h"),
  ];

  it("shows the most specific place per cover, and no country while there are enough others", () => {
    expect(explorePlaces(places).map(p => p.title)).toEqual([
      "Berlin",
      "Potsdam",
      "Lisbon",
      "Tromsø",
      "Milan",
      "Toronto",
    ]);
  });

  it("falls back to countries in a library with few places", () => {
    expect(explorePlaces(places.slice(0, 3)).map(p => p.title)).toEqual(["Germany", "Berlin"]);
  });
});

describe("exploreThings", () => {
  it("shows the six biggest things", () => {
    const things = [1, 2, 3, 4, 5, 6, 7, 8].map(n => thing(n, `t${n}`, n));
    expect(exploreThings(things).map(t => t.title)).toEqual(["t8", "t7", "t6", "t5", "t4", "t3"]);
  });
});

describe("matchesTerm", () => {
  it("matches every word at the start of a word of the name, ignoring case", () => {
    expect(matchesTerm("Lisbon", "lisbon")).toBe(true);
    expect(matchesTerm("New York City", "york")).toBe(true);
    expect(matchesTerm("New York City", "new cit")).toBe(true);
    expect(matchesTerm("Barcelona", "lona")).toBe(false);
    expect(matchesTerm("Lisbon", "  ")).toBe(false);
  });
});

describe("displayLabel", () => {
  it("capitalizes a classifier's lowercase label", () => {
    expect(displayLabel("street art")).toBe("Street art");
  });
});
