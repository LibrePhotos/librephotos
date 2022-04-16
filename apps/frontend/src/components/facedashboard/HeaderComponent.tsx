import React from "react";
import { useTranslation } from "react-i18next";
import { Divider, Header } from "semantic-ui-react";

type Props = {
  key: number;
  cell: any;
  entrySquareSize: number;
  width: number;
  style: any;
};

export function HeaderComponent(props: Props) {
  const { t } = useTranslation();

  return (
    <div
      key={props.key}
      style={{
        ...props.style,
        paddingTop: props.entrySquareSize / 2.0 - 35,
        width: props.width,
        height: props.entrySquareSize,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Header size="huge">
        <Header.Content>
          {props.cell.person_name}
          <Header.Subheader>
            {t("facesdashboard.numberoffaces", {
              number: props.cell.faces.length,
            })}
          </Header.Subheader>
        </Header.Content>
      </Header>
      <Divider />
    </div>
  );
}
