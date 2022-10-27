import { TextInput } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { random } from "lodash";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { push } from "redux-first-history";
import { Search } from "tabler-icons-react";

import { searchPhotos } from "../actions/searchActions";
import { fetchExampleSearchTerms } from "../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../store/store";

export function SimpleSearch() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { width: viewportWidth } = useViewportSize();
  const [searchPlaceholder, setSearchPlaceholder] = useState("");
  const exampleSearchTerms = useAppSelector(store => store.util.exampleSearchTerms);

  useEffect(() => {
    dispatch(fetchExampleSearchTerms());
  }, [dispatch]);

  useEffect(() => {
    const interval = setInterval(() => {
      const example = exampleSearchTerms[Math.floor(random(0.1, 1) * exampleSearchTerms.length)];
      setSearchPlaceholder(`${t("search.search")} ${example}`);
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [t, exampleSearchTerms]);

  const search = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const { value } = e.currentTarget;
      if (value.length === 0) {
        dispatch(push("/"));
      } else {
        dispatch(searchPhotos(value));
        dispatch(push("/search"));
      }
    }
  };

  return (
    <TextInput
      width={viewportWidth - viewportWidth / 2.2}
      icon={<Search size={14} />}
      placeholder={searchPlaceholder}
      onKeyPress={search}
    />
  );
}
