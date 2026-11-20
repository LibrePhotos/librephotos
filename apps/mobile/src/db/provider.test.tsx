import { useState } from "react";
import { Pressable, Text } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { sql } from "drizzle-orm";
import type { AppDatabase, DbChangeSubscribe } from "@librephotos/local-db";
import { createTestDb, remotePhoto, seedRemotePhotos, type TestDb } from "@librephotos/local-db/testing";
import { settleDb } from "@/test/test-utils";
import { createLiveQueryClient, DbProvider, useReactiveQuery } from "./provider";

async function photoCount(db: AppDatabase): Promise<number> {
  const row = await db.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM remote_photo`);
  return row.c;
}

function Count({ tables }: { tables?: readonly string[] }) {
  const { data, loading } = useReactiveQuery(["count"], photoCount, -1, { tables });
  return <Text testID="count">{loading ? "loading" : String(data)}</Text>;
}

describe("useReactiveQuery", () => {
  let t: TestDb;
  beforeEach(() => (t = createTestDb()));
  afterEach(() => t.close());

  it("reports the first load, then the rows", async () => {
    await seedRemotePhotos(t.db, [remotePhoto({ id: "a" })]);
    const view = render(
      <DbProvider db={t.db} subscribe={t.subscribe}>
        <Count />
      </DbProvider>
    );
    expect(view.getByTestId("count").props.children).toBe("loading");
    await settleDb();
    expect(view.getByTestId("count").props.children).toBe("1");
  });

  it("paints the cached result in the first frame of a remount", async () => {
    await seedRemotePhotos(t.db, [remotePhoto({ id: "a" }), remotePhoto({ id: "b" })]);
    const queries = createLiveQueryClient();
    function Screen() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <Pressable testID="toggle" onPress={() => setShown((s) => !s)} />
          {shown ? <Count /> : null}
        </>
      );
    }
    const view = render(
      <DbProvider db={t.db} subscribe={t.subscribe} queries={queries}>
        <Screen />
      </DbProvider>
    );
    await settleDb();
    fireEvent.press(view.getByTestId("toggle"));
    fireEvent.press(view.getByTestId("toggle"));
    expect(view.getByTestId("count").props.children).toBe("2");
  });

  it("re-runs when a table it reads changes, and not for other tables", async () => {
    let reads = 0;
    function Counted() {
      const { data } = useReactiveQuery(
        ["counted"],
        (db) => {
          reads += 1;
          return photoCount(db);
        },
        -1,
        { tables: ["remote_photo"] }
      );
      return <Text testID="counted">{String(data)}</Text>;
    }
    const view = render(
      <DbProvider db={t.db} subscribe={t.subscribe}>
        <Counted />
      </DbProvider>
    );
    await settleDb();
    expect(view.getByTestId("counted").props.children).toBe("0");
    expect(reads).toBe(1);

    await act(async () => {
      await t.db.run(sql`INSERT INTO app_meta (key, value) VALUES ('k', 'v')`);
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(reads).toBe(1);

    await act(async () => {
      await seedRemotePhotos(t.db, [remotePhoto({ id: "a" })]);
    });
    await waitFor(() => expect(view.getByTestId("counted").props.children).toBe("1"));
    expect(reads).toBe(2);
  });

  it("never lets a slow, older read overwrite a newer one", async () => {
    const listeners = new Set<(table?: string) => void>();
    const subscribe: DbChangeSubscribe = (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    };
    let call = 0;
    const answers: ((n: number) => void)[] = [];
    function Racing() {
      const { data } = useReactiveQuery(
        ["racing"],
        () => {
          call += 1;
          return new Promise<number>((resolve) => answers.push(resolve));
        },
        0
      );
      return <Text testID="racing">{String(data)}</Text>;
    }
    const view = render(
      <DbProvider db={t.db} subscribe={subscribe}>
        <Racing />
      </DbProvider>
    );
    await settleDb();
    expect(call).toBe(1);
    await act(async () => {
      answers[0]?.(5);
      await Promise.resolve();
    });
    await settleDb();
    expect(view.getByTestId("racing").props.children).toBe("5");

    const change = async () => {
      act(() => {
        for (const l of listeners) l("remote_photo");
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 150));
      });
    };
    await change();
    await change();
    expect(call).toBe(3);
    await act(async () => {
      answers[2]?.(7);
      await Promise.resolve();
      answers[1]?.(6);
    });
    await settleDb();
    expect(view.getByTestId("racing").props.children).toBe("7");
  });
});
