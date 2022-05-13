import { Navbar } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Dropdown, Icon } from "semantic-ui-react";
import { Globe } from "tabler-icons-react";

import { MainLink } from "./MenuLink";

export function SideMenuNarrowPublic(): JSX.Element {
  const matches = useMediaQuery("(min-width: 700px)");
  const { t } = useTranslation();

  if (!matches) {
    return <div></div>;
  }

  return (
    <Navbar p="sm" hidden={false} width={{ base: 100 }}>
      <Navbar.Section>
        <Dropdown
          pointing="left"
          item
          icon={<MainLink icon={<Globe size={33}></Globe>} color="green" label="Public" />}
        >
          <Dropdown.Menu>
            <Dropdown.Header>Public</Dropdown.Header>
            <Dropdown.Item as={Link} to="/users/">
              <Icon name="users" />
              {"  Users"}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </Navbar.Section>
    </Navbar>
  );
}
