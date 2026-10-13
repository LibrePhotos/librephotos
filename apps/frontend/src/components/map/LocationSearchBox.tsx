import { Combobox, Loader, Text, TextInput, useCombobox } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconAlertTriangle, IconMapPin, IconSearch } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGeocodeSearchQuery } from "../../api_client/geocode";
import { parseCoordinates } from "./parseCoordinates";
import type { TypedCoordinates } from "./parseCoordinates";
import { PlaceLines } from "./PlaceLines";

type Props = Readonly<{
  /** A place from the search, or typed coordinates, was picked. */
  onSelect: (lat: number, lon: number) => void;
}>;

/**
 * The location picker's search box: a place name goes to the server's geocoder, a pasted
 * "lat, lon" becomes a "Use coordinates" option without asking it (#2283).
 */
export function LocationSearchBox({ onSelect }: Props) {
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearch] = useDebouncedValue(searchValue, 300);
  const typed = parseCoordinates(searchValue);
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const { data: searchResults, isLoading: isSearching } = useGeocodeSearchQuery(debouncedSearch, typed === null);

  const select = (value: string) => {
    const [lat, lon] = value.split(",").map(Number);
    if (lat === undefined || lon === undefined) return;
    setSearchValue("");
    combobox.closeDropdown();
    onSelect(lat, lon);
  };

  return (
    <Combobox store={combobox} onOptionSubmit={select}>
      <Combobox.Target>
        <TextInput
          placeholder={t("locationpicker.search_placeholder")}
          aria-label={t("locationpicker.search_placeholder")}
          value={searchValue}
          onChange={e => {
            setSearchValue(e.currentTarget.value);
            combobox.openDropdown();
          }}
          onFocus={() => {
            if (searchValue.length > 2) {
              combobox.openDropdown();
            }
          }}
          onBlur={() => combobox.closeDropdown()}
          leftSection={<IconSearch size={16} />}
          rightSection={isSearching && typed === null ? <Loader size={16} /> : null}
          flex={1}
        />
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options>
          {typed ? (
            <CoordinatesOption typed={typed} />
          ) : searchResults && searchResults.length > 0 ? (
            searchResults.map(result => (
              <Combobox.Option value={`${result.lat},${result.lon}`} key={`${result.lat}-${result.lon}`}>
                <Text size="sm" lineClamp={2}>
                  {result.display_name}
                </Text>
              </Combobox.Option>
            ))
          ) : (
            <Combobox.Empty>
              {debouncedSearch.length > 2 ? t("locationpicker.no_results") : t("locationpicker.type_to_search")}
            </Combobox.Empty>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

function CoordinatesOption({ typed }: Readonly<{ typed: TypedCoordinates }>) {
  const { t } = useTranslation();
  if (typed.kind === "out_of_range") {
    return (
      <Combobox.Option value="" disabled>
        <PlaceLines
          icon={<IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />}
          title={t("locationpicker.not_a_position")}
          detail={t("locationpicker.position_ranges")}
        />
      </Combobox.Option>
    );
  }
  return (
    <Combobox.Option value={`${typed.lat},${typed.lon}`}>
      <PlaceLines
        icon={<IconMapPin size={16} color="var(--mantine-color-blue-6)" />}
        title={t("locationpicker.use_coordinates", { lat: typed.lat, lon: typed.lon })}
      />
    </Combobox.Option>
  );
}
