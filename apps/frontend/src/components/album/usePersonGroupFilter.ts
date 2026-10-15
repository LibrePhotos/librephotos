import { useFetchPersonGroupsQuery, type Person } from "../../api_client/albums/hooks";

/**
 * The group a page is filtered to (#1126), from its `?group=` param. Once the groups are loaded, an
 * id that is not one of them (deleted, or another user's link) means everybody; until then the id
 * is taken as it is, so the page asks for the right people from the start.
 */
export function usePersonGroupFilter(groupParam: number | undefined) {
  const { data: groups } = useFetchPersonGroupsQuery();
  const group = groups?.find(candidate => candidate.id === groupParam);
  const groupId = groups ? group?.id : groupParam;
  return { groups: groups ?? [], group, groupId };
}

/** The People page's people in the group of its `?group=` param, or all of them (#1126). */
export function usePeopleInGroup(people: readonly Person[] | undefined, groupParam: number | undefined) {
  const { groups, group, groupId } = usePersonGroupFilter(groupParam);
  const all = people ?? [];
  const shown = groupId === undefined ? all : all.filter(person => person.group_ids.includes(groupId));
  return { groups, group, shown };
}
