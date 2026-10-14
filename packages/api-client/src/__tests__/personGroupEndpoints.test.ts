/**
 * The person group endpoints (#1126): the request each one sends and the parsed answer, against what
 * PersonGroupViewSet (api/views/person_groups.py) and PersonViewSet.groups answered in a test run.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { Person } from "../schemas";
import { defined } from "./defined";
import { fakeServer, fakeServerByUrl } from "./harness";

const API = "https://demo.example.com/api";

const family = { id: 3, name: "Family", person_count: 2 };

describe("person groups", () => {
  it("reads every page of the user's groups", async () => {
    const work = { id: 4, name: "Work", person_count: 0 };
    const { client, requests } = fakeServerByUrl(url =>
      url.includes("page=2")
        ? { count: 2, next: null, previous: null, results: [work] }
        : { count: 2, next: `${API}/person-groups/?page=2`, previous: null, results: [family] }
    );
    expect(await endpoints.fetchPersonGroups(client)).toEqual([family, work]);
    expect(requests.map(request => request.url)).toEqual([`${API}/person-groups/`, `${API}/person-groups/?page=2`]);
  });

  it("creates, renames and deletes a group", async () => {
    const create = fakeServer({ id: 3, name: "Family", person_count: 0 });
    expect((await endpoints.createPersonGroup(create.client, "Family")).id).toBe(3);
    const rename = fakeServer({ ...family, name: "Kin" });
    expect((await endpoints.renamePersonGroup(rename.client, 3, "Kin")).person_count).toBe(2);
    const remove = fakeServer(null);
    await endpoints.deletePersonGroup(remove.client, 3);
    const sent = [create, rename, remove].map(({ requests }) => defined(requests[0]));
    expect(sent).toEqual([
      { url: `${API}/person-groups/`, method: "POST", body: { name: "Family" } },
      { url: `${API}/person-groups/3/`, method: "PATCH", body: { name: "Kin" } },
      { url: `${API}/person-groups/3/`, method: "DELETE", body: undefined },
    ]);
  });

  it("puts a person in exactly the given groups", async () => {
    const { client, requests } = fakeServer({ group_ids: [3, 4] });
    expect(await endpoints.setPersonGroups(client, "12", [3, 4])).toEqual({ group_ids: [3, 4] });
    expect(defined(requests[0])).toEqual({
      url: `${API}/persons/12/groups/`,
      method: "PUT",
      body: { group_ids: [3, 4] },
    });
  });

  it("narrows the face dashboard's people to a group", async () => {
    const { client, requests } = fakeServer([]);
    await endpoints.fetchIncompleteFaces(client, { inferred: false, orderBy: "date", group: 3 });
    expect(defined(requests[0]).url).toBe(`${API}/faces/incomplete/?inferred=false&order_by=date&group=3`);
  });

  it("reads a person from a server before groups", () => {
    const person = { name: "Anna", face_url: "", face_count: 1, face_photo_url: "", id: 1 };
    expect(Person.parse(person).group_ids).toBeUndefined();
    expect(Person.parse({ ...person, group_ids: [3] }).group_ids).toEqual([3]);
  });
});
