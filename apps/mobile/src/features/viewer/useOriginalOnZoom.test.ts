import { act, renderHook } from "@testing-library/react-native";
import { useOriginalOnZoom } from "./useOriginalOnZoom";

describe("useOriginalOnZoom", () => {
  it("remembers the first zoom for the active slide and starts over on the next one", () => {
    const { result, rerender } = renderHook(({ key }: { key: string }) => useOriginalOnZoom(key), {
      initialProps: { key: "a" },
    });
    expect(result.current.zoomedOnce).toBe(false);

    act(() => result.current.onZoomChange("a", true));
    act(() => result.current.onZoomChange("a", false));
    expect(result.current).toMatchObject({ zoomed: false, zoomedOnce: true });

    // Swiping on goes back to thumbnails.
    rerender({ key: "b" });
    expect(result.current).toMatchObject({ zoomed: false, zoomedOnce: false, attempt: 0 });
  });

  it("ignores an event from a slide that is no longer active", () => {
    const { result } = renderHook(() => useOriginalOnZoom("b"));
    act(() => result.current.onZoomChange("a", true));
    expect(result.current.zoomedOnce).toBe(false);
  });

  it("follows the load and starts it over on Try again", () => {
    const { result } = renderHook(() => useOriginalOnZoom("a"));
    act(() => result.current.onProgress("a", { loaded: 5, total: 10 }));
    expect(result.current.load).toMatchObject({ status: "loading", loaded: 5, total: 10 });
    act(() => result.current.onError("a"));
    expect(result.current.load.status).toBe("failed");
    act(() => result.current.retry("a"));
    expect(result.current).toMatchObject({ attempt: 1, load: { status: "loading", loaded: 0, total: 0 } });
    act(() =>
      result.current.onLoad("a", { cacheType: "none", source: { url: "", width: 40, height: 30, mediaType: null } })
    );
    expect(result.current.load).toMatchObject({ status: "loaded", size: { width: 40, height: 30 } });
  });
});
