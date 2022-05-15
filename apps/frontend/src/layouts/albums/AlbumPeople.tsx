import { useResizeObserver, useViewportSize } from "@mantine/hooks";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation, withTranslation } from "react-i18next";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { AutoSizer, Grid } from "react-virtualized";
import { compose } from "redux";
import { Button, Confirm, Dropdown, Header, Icon, Image, Input, Label, Loader, Modal, Popup } from "semantic-ui-react";

import { deletePerson, fetchPeople, renamePerson } from "../../actions/peopleActions";
import { Tile } from "../../components/Tile";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { TOP_MENU_HEIGHT } from "../../ui-constants";

const SIDEBAR_WIDTH = 85;

export const AlbumPeople = () => {
  const { width, height } = useViewportSize();
  const [entrySquareSize, setEntrySquareSize] = useState(200);

  const [numEntrySquaresPerRow, setNumEntrySquaresPerRow] = useState(0);
  const [openDeleteDialogState, setOpenDeleteDialogState] = useState(false);
  const [openRenameDialogState, setOpenRenameDialogState] = useState(false);
  const [personID, setPersonID] = useState("");
  const [personName, setPersonName] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const { people, fetching } = useAppSelector(store => store.people);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const openDeleteDialog = (personID, personName) => {
    setOpenDeleteDialogState(true);
    setPersonID(personID);
    setPersonName(personName);
  };
  const openRenameDialog = (personID, personName) => {
    setOpenRenameDialogState(true);
    setPersonID(personID);
    setPersonName(personName);
  };

  const [ref, rect] = useResizeObserver();
  useEffect(() => {
    calculateEntrySquareSize();
  }, [rect]);

  useEffect(() => {
    if (people.length === 0) {
      fetchPeople(dispatch);
    }
  }, []);

  const calculateEntrySquareSize = () => {
    let numEntrySquaresPerRow = 6;
    if (window.innerWidth < 600) {
      numEntrySquaresPerRow = 2;
    } else if (window.innerWidth < 800) {
      numEntrySquaresPerRow = 3;
    } else if (window.innerWidth < 1000) {
      numEntrySquaresPerRow = 4;
    } else if (window.innerWidth < 1200) {
      numEntrySquaresPerRow = 5;
    }

    const columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15;

    const entrySquareSize = columnWidth / numEntrySquaresPerRow;

    setNumEntrySquaresPerRow(numEntrySquaresPerRow);
    setEntrySquareSize(entrySquareSize);
  };

  const cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    const albumPersonIndex = rowIndex * numEntrySquaresPerRow + columnIndex;
    if (albumPersonIndex < people.length) {
      return (
        <div key={key} style={style}>
          <div style={{ padding: 5 }}>
            {people[albumPersonIndex].face_count > 0 ? (
              people[albumPersonIndex].text === "unknown" ? (
                <Image
                  height={entrySquareSize - 10}
                  width={entrySquareSize - 10}
                  as={Link}
                  to={`/person/${people[albumPersonIndex].key}`}
                  src="/unknown_user.jpg"
                />
              ) : (
                <Link to={`/person/${people[albumPersonIndex].key}`}>
                  <Tile
                    video={people[albumPersonIndex].video === true}
                    height={entrySquareSize - 10}
                    width={entrySquareSize - 10}
                    image_hash={people[albumPersonIndex].face_photo_url}
                  />
                </Link>
              )
            ) : (
              <Image height={entrySquareSize - 10} width={entrySquareSize - 10} src="/unknown_user.jpg" />
            )}
            <Label style={{ backgroundColor: "transparent" }} attached="top right">
              <Dropdown item icon={<Icon color="black" name="ellipsis vertical" />}>
                <Dropdown.Menu>
                  <Dropdown.Item
                    icon="edit"
                    onClick={() => openRenameDialog(people[albumPersonIndex].key, people[albumPersonIndex].text)}
                    text={t("rename")}
                  />
                  <Dropdown.Item
                    icon="delete"
                    onClick={() => {
                      openDeleteDialog(people[albumPersonIndex].key, people[albumPersonIndex].text);
                    }}
                    text={t("delete")}
                  />
                </Dropdown.Menu>
              </Dropdown>
            </Label>
          </div>
          <div className="personCardName" style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
            <b>{people[albumPersonIndex].text}</b> <br />
            {t("numberofphotos", {
              number: people[albumPersonIndex].face_count,
            })}
          </div>
        </div>
      );
    }
    return <div key={key} style={style} />;
  };

  return (
    <div ref={ref}>
      <div style={{ height: 60, paddingTop: 10 }}>
        <Header as="h2">
          <Icon name="users" />
          <Header.Content>
            {t("people")} <Loader size="tiny" inline active={fetching} />
            <Header.Subheader>
              {t("personalbum.numberofpeople", {
                peoplelength: people.length,
              })}
            </Header.Subheader>
          </Header.Content>
        </Header>
      </div>
      <Modal
        size="mini"
        onClose={() => setOpenRenameDialogState(false)}
        onOpen={() => setOpenRenameDialogState(true)}
        open={openRenameDialogState}
      >
        <div style={{ padding: 20 }}>
          <Header as="h4">{t("personalbum.renameperson")}</Header>
          <Popup
            inverted
            content={t("personalbum.personalreadyexists", {
              name: newPersonName.trim(),
            })}
            position="bottom center"
            open={people.map(el => el.text.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())}
            trigger={
              <Input
                fluid
                error={people.map(el => el.text.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())}
                onChange={(e, v) => {
                  setNewPersonName(v.value);
                }}
                placeholder={t("personalbum.nameplaceholder")}
                action
              >
                <input />
                <Button
                  positive
                  onClick={() => {
                    dispatch(renamePerson(personID, personName, newPersonName));
                    setOpenRenameDialogState(false);
                  }}
                  disabled={people.map(el => el.text.toLowerCase().trim()).includes(newPersonName.toLowerCase().trim())}
                  type="submit"
                >
                  {t("rename")}
                </Button>
              </Input>
            }
          />
        </div>
      </Modal>
      <Confirm
        open={openDeleteDialogState}
        onCancel={() => setOpenDeleteDialogState(false)}
        onConfirm={() => {
          dispatch(deletePerson(personID));
          setOpenDeleteDialogState(false);
        }}
      />
      <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
        {({ width }) => (
          <Grid
            style={{ outline: "none" }}
            headerHeight={100}
            disableHeader={false}
            cellRenderer={cellRenderer}
            columnWidth={entrySquareSize}
            columnCount={numEntrySquaresPerRow}
            height={height - TOP_MENU_HEIGHT - 60}
            rowHeight={entrySquareSize + 60}
            // @ts-ignore
            rowCount={Math.ceil(people.length / numEntrySquaresPerRow.toFixed(1))}
            width={width}
          />
        )}
      </AutoSizer>
    </div>
  );
};
