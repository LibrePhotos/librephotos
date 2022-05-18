import { Avatar, Box, Center } from "@mantine/core";
import _ from "lodash";
import React from "react";

import { serverAddress } from "../../api_client/apiClient";
import { PhotoIcon } from "./PhotoIcon";
import { ProbabilityIcon } from "./ProbabiltyIcon";

type Props = {
  cell: any;
  isScrollingFast: boolean;
  selectMode: boolean;
  entrySquareSize: number;
  isSelected: boolean;
  activeItem: number;
  handleClick: (e: any, cell: any) => void;
};

export function FaceComponent(props: Props) {
  const labelProbabilityIcon = <ProbabilityIcon probability={props.cell.person_label_probability} />;
  const showPhotoIcon = <PhotoIcon photo={props.cell.photo} />;
  // TODO: janky shit going on in the next line!
  const faceImageSrc = `${serverAddress}/media/faces/${_.reverse(props.cell.image.split("/"))[0]}`;
  if (props.isScrollingFast) {
    return <Avatar radius="xl" src="/thumbnail_placeholder.png" size={props.entrySquareSize - 10} />;
  }
  if (props.selectMode) {
    const { isSelected } = props;
    return (
      <Box
        sx={theme => ({
          display: "block",
          backgroundColor: isSelected ? "rgba(174, 214, 241, 0.4)" : "transparent",
          alignContent: "center",
          borderRadius: theme.radius.md,
          padding: 10,
          marginRight: 10,
          cursor: "pointer",
          "&:hover": {
            backgroundColor: isSelected ? "rgba(174, 214, 241, 0.8)" : "rgba(174, 214, 241, 0.6)",
          },
        })}
      >
        <Avatar
          radius="xl"
          onClick={(e: any) => {
            props.handleClick(e, props.cell);
          }}
          src={faceImageSrc}
          size={props.entrySquareSize - 30}
        />
        {props.activeItem === 1 && labelProbabilityIcon}

        {showPhotoIcon}
      </Box>
    );
  }
  return (
    <Box
      sx={theme => ({
        display: "block",
        backgroundColor: "transparent",
        alignContent: "center",
        borderRadius: theme.radius.md,
        padding: 0,
        marginRight: 10,
        cursor: "pointer",
        "&:hover": {
          backgroundColor: "rgba(174, 214, 241, 0.6)",
        },
      })}
    >
      <Avatar
        onClick={(e: any) => {
          props.handleClick(e, props.cell);
        }}
        radius="xl"
        src={faceImageSrc}
        size={props.entrySquareSize - 10}
      />
      {props.activeItem === 1 && labelProbabilityIcon}
      {showPhotoIcon}
    </Box>
  );
}
