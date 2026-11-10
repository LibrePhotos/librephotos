/** A place tree with uneven branches, for the place tree's layout tests. */
export const PLACE_TREE_FIXTURE = {
  name: "Places",
  children: [
    {
      name: "Germany",
      value: 9,
      children: [
        {
          name: "Bavaria",
          value: 6,
          children: [
            { name: "Munich", value: 4 },
            { name: "Nuremberg", value: 1 },
            { name: "Garmisch-Partenkirchen", value: 1 },
          ],
        },
        { name: "Berlin", value: 2 },
        { name: "Hamburg", value: 1 },
      ],
    },
    { name: "Portugal", value: 3, children: [{ name: "Lisbon", value: 3, children: [{ name: "Baixa", value: 3 }] }] },
    { name: "Iceland", value: 1 },
    {
      name: "Japan",
      value: 5,
      children: [
        { name: "Tokyo", value: 3 },
        { name: "Kyoto", value: 2 },
      ],
    },
  ],
};
