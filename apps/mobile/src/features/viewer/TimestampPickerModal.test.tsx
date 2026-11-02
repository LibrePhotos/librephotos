import { Platform } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { TimestampPickerModal } from "./TimestampPickerModal";
import { renderWithProviders, makeMockClient, jsonResponse } from "@/test/test-utils";

type OpenArgs = Parameters<typeof DateTimePickerAndroid.open>[0];

const open = jest.mocked(DateTimePickerAndroid.open);
const opened = (): OpenArgs[] => open.mock.calls.map(([args]) => args);
const set = { type: "set" as const, nativeEvent: { timestamp: 0, utcOffset: 0 } };

describe("TimestampPickerModal on Android", () => {
  const original = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => "android" });
    open.mockClear();
  });
  afterEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, get: () => original });
  });

  function render(onSave = jest.fn(), onCancel = jest.fn()) {
    const client = makeMockClient(async () => jsonResponse({}, 404));
    renderWithProviders(
      <TimestampPickerModal visible value={Date.UTC(2021, 1, 27, 8, 17)} locale="en-US" onSave={onSave} onCancel={onCancel} />,
      client
    );
    return { onSave, onCancel };
  }

  it("opens the date dialog, then the time dialog, and saves on the second OK", () => {
    const { onSave, onCancel } = render();
    expect(opened()).toHaveLength(1);
    expect(opened()[0].mode).toBe("date");

    const day = new Date(2020, 4, 6, 8, 17);
    opened()[0].onValueChange?.(set, day);
    expect(opened()[1].mode).toBe("time");
    expect(opened()[1].value).toBe(day);

    const moment = new Date(2020, 4, 6, 7, 8);
    opened()[1].onValueChange?.(set, moment);
    expect(onSave).toHaveBeenCalledWith(moment);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels when either dialog is dismissed, without a sheet of its own", () => {
    const { onSave, onCancel } = render();
    opened()[0].onDismiss?.();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
