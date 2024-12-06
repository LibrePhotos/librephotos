import { ActionIcon, Combobox, Group, Image, InputBase, Loader, Popover, Text, useCombobox } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { IconAlbum, IconMap, IconSearch, IconTag, IconUser, IconX } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { push } from "redux-first-history";

import { SearchOption, SearchOptionType, useSearch } from "../service/use-search";
import { useAppDispatch } from "../store/store";
import classes from "./SiteSearch.module.css";

const ICON_SIZE = 20;

function getIconForItem(item: SearchOption) {
  switch (item.type) {
    case SearchOptionType.PLACE_ALBUM:
      return <IconMap size={ICON_SIZE} />;
    case SearchOptionType.THING_ALBUM:
      return <IconTag size={ICON_SIZE} />;
    case SearchOptionType.USER_ALBUM:
      return <IconAlbum size={ICON_SIZE} />;
    case SearchOptionType.PEOPLE:
      return <IconUser size={ICON_SIZE} />;
    case SearchOptionType.EXAMPLE:
    default:
      return <IconSearch size={ICON_SIZE} />;
  }
}

export function SiteSearch() {
  const { t } = useTranslation();
  const { width } = useViewportSize();
  const { options, filterOptions, placeholder, isLoading } = useSearch();
  const combobox = useCombobox();
  const dispatch = useAppDispatch();
  const searchWidth = width ? width - width / 1.8 : 200;
  const [value, setValue] = React.useState("");
  const [personToBeSelected, setPersonToBeSelected] = React.useState<string | null>(null);

  function getSearchRightIcon() {
    if (isLoading) return <Loader size="xs" type="dots" />;
    if (value) {
      return (
        <IconX
          className={classes.clearSearch}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            setValue("");
            filterOptions("");
          }}
          aria-label="Clear value"
        />
      );
    }
    return null;
  }

  function showPersonNameToBeSelected(name: string): boolean {
    return name === personToBeSelected;
  }

  function search(query: string) {
    const item = options.find(i => i.value === query);
    switch (item?.type) {
      case SearchOptionType.EXAMPLE:
        dispatch(push(`/search/${item.data}`));
        break;
      case SearchOptionType.USER_ALBUM:
        dispatch(push(`/useralbum/${item.data}`));
        break;
      case SearchOptionType.PLACE_ALBUM:
        dispatch(push(`/place/${item.data}`));
        break;
      case SearchOptionType.THING_ALBUM:
        dispatch(push(`/thing/${item.data}`));
        break;
      case SearchOptionType.PEOPLE:
        dispatch(push(`/person/${item.data}`));
        break;
      default:
        dispatch(push(`/search/${query}`));
        break;
    }
  }

  function onOptionSubmit(val: string) {
    setValue(val);
    search(val);
    combobox.closeDropdown();
  }

  const searchOptionsDefault = options.filter(option => option.type !== SearchOptionType.PEOPLE);
  const searchOptionsPeople = options.filter(option => option.type === SearchOptionType.PEOPLE);
  const searchOptions = searchOptionsDefault
    .map(item => (
      <Combobox.Option value={item.value} key={item.value}>
        <Group wrap="nowrap">
          {getIconForItem(item)}
          <Text>{item.value}</Text>
        </Group>
      </Combobox.Option>
    ))
    .concat([
      <Combobox.Empty className={classes.people}>
        <Group wrap="nowrap">
          {searchOptionsPeople.map(person => (
            <Popover withArrow opened={showPersonNameToBeSelected(person.value)}>
              <Popover.Target>
                <ActionIcon
                  className={classes.person}
                  onMouseEnter={() => setPersonToBeSelected(person.value)}
                  onMouseLeave={() => setPersonToBeSelected(null)}
                  size="xl"
                  radius="xl"
                  variant="transparent"
                  onClick={() => onOptionSubmit(person.value)}
                >
                  <Image src={person.thumbnail} />
                </ActionIcon>
              </Popover.Target>
              <Popover.Dropdown p="xs">
                <Text size="xs">{person.value}</Text>
              </Popover.Dropdown>
            </Popover>
          ))}
        </Group>
      </Combobox.Empty>,
    ]);

  return (
    <div style={{ width: searchWidth }}>
      <Combobox store={combobox} withinPortal onOptionSubmit={option => onOptionSubmit(option)}>
        <Combobox.Target>
          <InputBase
            leftSection={<IconSearch size={16} />}
            rightSection={getSearchRightIcon()}
            value={value}
            onChange={event => {
              combobox.openDropdown();
              combobox.updateSelectedOptionIndex();
              setValue(event.currentTarget.value);
              filterOptions(event.currentTarget.value);
            }}
            onKeyUp={event => {
              if (event.code === "Enter") {
                search(value);
                combobox.closeDropdown();
              }
            }}
            onClick={() => combobox.openDropdown()}
            onFocus={() => combobox.openDropdown()}
            onBlur={() => combobox.closeDropdown()}
            placeholder={placeholder}
            rightSectionPointerEvents={value === null ? "none" : "all"}
          />
        </Combobox.Target>

        <Combobox.Dropdown>
          <Combobox.Options>
            {isLoading ? <Combobox.Empty>{t("loading")}</Combobox.Empty> : searchOptions}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
    </div>
  );
}
