import React from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "../hooks";
import { useDropzone } from "react-dropzone";
import { Button, Icon } from "semantic-ui-react";
import { uploadPhotos } from "../actions/photosActions";
export const UploadButton = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  // To-Do: forget accepted files after onDrop...
  const { getRootProps, getInputProps, open, acceptedFiles } = useDropzone({
    //accept: "image/*",
    noClick: true,
    noKeyboard: true,
    onDrop: (acceptedFiles) => {
      var form_data = new FormData();
      acceptedFiles.forEach((file) => {
        form_data.append(file.name, file);
      });
      //Check again if something gets send
      uploadPhotos(form_data, dispatch);
    },
  });

  return (
    <div className="container">
      <div {...getRootProps({ className: "dropzone" })}>
        <input {...getInputProps()} />
        <Button icon="upload" onClick={open}></Button>
      </div>
    </div>
  );
};
