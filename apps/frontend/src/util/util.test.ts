import type { DirTree } from "../api_client/dir-tree";
import type { DatePhotosGroup } from "../api_client/photos/types";
import i18n from "../i18n";
import {
  copyImageToClipboard,
  EMAIL_REGEX,
  formatDateForPhotoGroups,
  fuzzyMatch,
  getAveragedCoordinates,
  mergeDirTree,
} from "./util";

describe("email regex test", () => {
  test("good samples should match", () => {
    const validGoodEmailSamples = [
      "email@domain.com",
      "first.last@domain.com",
      "email@subdomain.name.com",
      "firstname+lastname@domain.com",
      "first.name+last.name@domain.com",
      "first-name+last-name@domain.com",
      "first.name+last-name@domain.com",
      "first-name+last.name@domain.com",
      "first-namelast.name@domain.com",
      "first.namelast-name@domain.com",
      "email@domain-one.com",
      "email@domain.name",
      "email@example.domain.name",
      "firstname-lastname@example.com",
      "1234567890@domain.com",
      "_______@example.com",
      "valid.name@aa.bb.cc.dd.ee.ff.gg.hh.jj.com",
      "a@bcd.ef",
      "first.m.last@domain.com",
    ];

    validGoodEmailSamples.forEach(sample => {
      expect(EMAIL_REGEX.test(sample)).toBeTruthy();
    });
  });

  test("bad samples should not match", () => {
    const validBadEmailSamples = [
      "email@123.123.123.123",
      "email@[123.123.123.123]",
      "much.“more unusual”@example.com",
      "very.unusual.“@”.unusual.com@example.com",
      'very.“(),:;<>[]”.VERY.“very@\\ "very”.unusual@strange.example.com',
      "“email”@example.com",
      "valid.name@aa.bb.cc.dd.ee.ff.gg.hh.jj.ii.com",
    ];

    validBadEmailSamples.forEach(sample => {
      expect(EMAIL_REGEX.test(sample)).toBeFalsy();
    });
  });

  test("invalid email samples should not match", () => {
    const invalidBadEmailSamples = [
      "plainaddress",
      "#@%^%#$@#$@#.com",
      "@example.com",
      "Joe Smith <email@example.com>",
      "email.example.com",
      "email@example@example.com",
      ".email@example.com",
      "email.@example.com",
      "email..email@example.com",
      "あいうえお@example.com",
      "email@example.com (Joe Smith)",
      "email@example",
      "email@-example.com",
      "email@111.222.333.44444",
      "email@example..com",
      "Abc..123@example.com",
      "“(),:;<>[]@example.com",
      'just"not"right@example.com',
      'this is"really"notallowed@example.com',
    ];

    invalidBadEmailSamples.forEach(sample => {
      expect(EMAIL_REGEX.test(sample)).toBeFalsy();
    });
  });
});

describe("fuzzyMatch", () => {
  test("matches", () => {
    const matches = [
      { value: "Dinosaur", query: "Dinosaur", result: true },
      { value: "Kraken", query: "KRAKEN", result: true },
      { value: "ELEPHANT", query: "elephant", result: true },
      { value: "Dinosaur", query: "dino", result: true },
      { value: "Dinosaur", query: "saur", result: true },
      { value: "Dinosaur", query: "INO", result: true },
      { value: "Dino saur", query: "nosa", result: true },
      { value: "var{var}", query: "{var", result: true },
      { value: "$dollar", query: "$dol", result: true },
      { value: "many*many", query: "many*m", result: true },
      { value: "what's up?", query: "what?", result: true },
      { value: "Dinosaur", query: "abr", result: false },
      { value: "Dinosaur", query: "sauron", result: false },
      { value: "what?", query: "what's up?", result: false },
      { value: "asdf", query: "asf", result: true },
      { value: "asdf", query: "asff", result: false },
    ];

    matches.forEach(item => {
      expect(fuzzyMatch(item.query, item.value)).toBe(item.result);
    });
  });
});

test("merge directory tree", () => {
  const tree: DirTree[] = [
    {
      title: "root",
      absolute_path: "/",
      children: [
        {
          title: "dir1",
          absolute_path: "/dir1",
          children: [
            {
              title: "dir1-1",
              absolute_path: "/dir1/dir1-1",
              children: [],
            },
          ],
        },
        {
          title: "dir2",
          absolute_path: "/dir2",
          children: [],
        },
      ],
    },
  ];
  const branch: DirTree = {
    title: "dir1-1",
    absolute_path: "/dir1/dir1-1",
    children: [
      {
        title: "dir1-1-1",
        absolute_path: "/dir1/dir1-1/dir1-1-1",
        children: [
          {
            title: "dir1-1-1-1",
            absolute_path: "/dir1/dir1-1/dir1-1-1/dir1-1-1-1",
            children: [],
          },
        ],
      },
    ],
  };
  const expected: DirTree[] = [
    {
      title: "root",
      absolute_path: "/",
      children: [
        {
          title: "dir1",
          absolute_path: "/dir1",
          children: [
            {
              title: "dir1-1",
              absolute_path: "/dir1/dir1-1",
              children: [
                {
                  title: "dir1-1-1",
                  absolute_path: "/dir1/dir1-1/dir1-1-1",
                  children: [
                    {
                      title: "dir1-1-1-1",
                      absolute_path: "/dir1/dir1-1/dir1-1-1/dir1-1-1-1",
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          title: "dir2",
          absolute_path: "/dir2",
          children: [],
        },
      ],
    },
  ];

  expect(mergeDirTree(tree, branch)).toEqual(expected);
});

describe("adjust date for photo list group", () => {
  test("should format date, set year and month", () => {
    const photoGroups: DatePhotosGroup[] = [
      {
        date: "2023-03-03",
        location: "",
        items: [],
      },
      {
        date: "2023-05-06",
        location: "",
        items: [],
      },
    ];
    const actual = formatDateForPhotoGroups(photoGroups);
    expect(actual[0].date).toEqual("Friday, March 3, 2023");
    expect(actual[0].year).toEqual(2023);
    expect(actual[0].month).toEqual(3);
    expect(actual[1].date).toEqual("Saturday, May 6, 2023");
    expect(actual[1].year).toEqual(2023);
    expect(actual[1].month).toEqual(5);
  });

  it("should return original date if it is not valid", () => {
    const photoGroups: DatePhotosGroup[] = [
      {
        date: "invalid date",
        location: "",
        items: [],
      },
    ];
    const actual = formatDateForPhotoGroups(photoGroups);
    expect(actual).toEqual(photoGroups);
  });

  it("should return localised string if date is null", () => {
    const photoGroups: DatePhotosGroup[] = [
      {
        date: null,
        location: "",
        items: [],
      },
    ];
    const actual = formatDateForPhotoGroups(photoGroups);
    expect(actual[0].date).toEqual(i18n.t("sidemenu.withouttimestamp"));
  });
});

describe("getAveragedCoordinates", () => {
  test("should return average coordinates", () => {
    const actual = getAveragedCoordinates([
      { id: "1", exif_gps_lat: 1, exif_gps_lon: 2 },
      { id: "2", exif_gps_lat: 3, exif_gps_lon: 4 },
      { id: "3", exif_gps_lat: -3, exif_gps_lon: 6 },
      { id: "4", exif_gps_lat: 2, exif_gps_lon: 1 },
    ]);
    expect(actual).toEqual({ avgLat: 0.75, avgLon: 3.25 });
  });
});

describe("copyImageToClipboard", () => {
  const sourceBlob = new Blob(["source"], { type: "image/webp" });
  const pngBlob = new Blob(["png"], { type: "image/png" });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        blob: () => Promise.resolve(sourceBlob),
      })
    );
    URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(pngBlob));
    vi.stubGlobal(
      "ClipboardItem",
      class MockClipboardItem {
        constructor(public items: Record<string, Blob>) {}
      }
    );
    vi.stubGlobal("navigator", {
      clipboard: { write: vi.fn().mockResolvedValue(undefined) },
    });

    class MockImage {
      naturalWidth = 100;

      naturalHeight = 50;

      onload: (() => void) | null = null;

      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", MockImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("fetches the image, converts it to PNG and writes it to the clipboard", async () => {
    await copyImageToClipboard("https://example.com/media/thumbnails_big/abc");

    expect(fetch).toHaveBeenCalledWith("https://example.com/media/thumbnails_big/abc", { credentials: "include" });
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    const [clipboardItem] = (navigator.clipboard.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(clipboardItem.items).toEqual({ "image/png": pngBlob });
  });

  test("rejects when the image fails to load", async () => {
    class FailingImage {
      onload: (() => void) | null = null;

      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onerror?.();
      }
    }
    vi.stubGlobal("Image", FailingImage);

    await expect(copyImageToClipboard("https://example.com/media/thumbnails_big/abc")).rejects.toThrow(
      "Could not load image"
    );
  });
});
