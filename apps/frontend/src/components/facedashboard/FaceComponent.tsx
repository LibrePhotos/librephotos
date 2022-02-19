import React from "react";
import { SecuredImageJWT } from "../../components/SecuredImage";
import { ProbabilityIcon } from "./ProbabiltyIcon";
import { PhotoIcon } from "./PhotoIcon";

import { serverAddress } from "../../api_client/apiClient";

import _ from "lodash";
type Props = {
  key: number;
  cell: any;
  isScrollingFast: boolean;
  selectMode: boolean;
  entrySquareSize: number;
  isSelected: boolean;
  style: any;
  activeItem: string;
  handleClick: (e: any, cell: any) => void;
};

export const FaceComponent = (props: Props) => {
  const labelProbabilityIcon = (
    <ProbabilityIcon probability={props.cell.person_label_probability} />
  );
  const showPhotoIcon = <PhotoIcon photo={props.cell.photo} />;
  // TODO: janky shit going on in the next line!
  const faceImageSrc =
    serverAddress + "/media/faces/" + _.reverse(props.cell.image.split("/"))[0];
  if (props.isScrollingFast) {
    return (
      <div key={props.key} style={{ ...props.style, padding: 5 }}>
        <SecuredImageJWT
          rounded
          src={"/thumbnail_placeholder.png"}
          height={props.entrySquareSize - 10}
          width={props.entrySquareSize - 10}
        />
      </div>
    );
  } else {
    if (props.selectMode) {
      const isSelected = props.isSelected;
      return (
        <div key={props.key} style={{ ...props.style, padding: 5 }}>
          <div
            style={{
              padding: 10,
              backgroundColor: isSelected ? "#AED6F1" : "#eeeeee",
            }}
          >
            <SecuredImageJWT
              rounded
              onClick={(e: any) => {
                props.handleClick(e, props.cell);
              }}
              src={faceImageSrc}
              height={props.entrySquareSize - 30}
              width={props.entrySquareSize - 30}
            />
            {props.activeItem === "inferred" && labelProbabilityIcon}
            {showPhotoIcon}
          </div>
        </div>
      );
    } else {
      return (
        <div key={props.key} style={{ ...props.style, padding: 5 }}>
          <SecuredImageJWT
            rounded
            onClick={(e: any) => {
              props.handleClick(e, props.cell);
            }}
            src={faceImageSrc}
            height={props.entrySquareSize - 10}
            width={props.entrySquareSize - 10}
          />
          {props.activeItem === "inferred" && labelProbabilityIcon}
          {showPhotoIcon}
        </div>
      );
    }
  }
};
