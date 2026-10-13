import { useMemo } from "react";
import { useFetchPeopleAlbumsQuery } from "../../../api_client/albums/hooks";

const NO_COVERS: ReadonlyMap<number, string> = new Map();

/** Each person's own cover face (the People page's), by person id; people without one are left out. */
export function usePeopleCovers(): ReadonlyMap<number, string> {
  const { data: people } = useFetchPeopleAlbumsQuery();
  return useMemo(
    () =>
      people
        ? new Map(people.filter(person => person.face_url).map(person => [Number(person.id), person.face_url]))
        : NO_COVERS,
    [people]
  );
}
