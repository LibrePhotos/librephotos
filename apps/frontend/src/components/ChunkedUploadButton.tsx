import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useDropzone } from "react-dropzone";
import { Button, Progress } from "semantic-ui-react";
import { Server } from "../api_client/apiClient";
import MD5 from "crypto-js/md5";
import CryptoJS from "crypto-js";
import { useAppDispatch, useAppSelector } from "../store/store";
import { api } from "../api_client/api";
import { IUploadResponse } from "../store/upload/upload.zod";

export const ChunkedUploadButton = ({ token }: { token?: string }) => {
  const { t } = useTranslation();
  const [totalSize, setTotalSize] = useState(1);
  const [currentSize, setCurrentSize] = useState(1);
  const { userSelfDetails } = useAppSelector(state => state.user);
  const { siteSettings } = useAppSelector(state => state.util);
  const dispatch = useAppDispatch();
  const chunkSize = 100000; // 100kb chunks
  const [upload] = api.useUploadMutation();
  let currentUploadedFileSize = 0;
  const { getRootProps, getInputProps, open, acceptedFiles } = useDropzone({
    accept: ["image/*", "video/*"],
    noClick: true,
    noKeyboard: true,
    onDrop: async acceptedFiles => {
      let totalSize = 0;
      acceptedFiles.forEach(file => {
        const fileSize = file.size;
        totalSize += fileSize;
      });
      setTotalSize(totalSize);
      const currentUploadedFileSizeStartValue = currentUploadedFileSize;
      for (const file of acceptedFiles) {
        // Check if the upload already exists via the hash of the file
        const hash = (await calculateMD5(file)) + userSelfDetails.id;
        const isAlreadyUploaded = (await uploadExists(hash)).data;
        if (!isAlreadyUploaded) {
          const chunks = calculateChunks(file, chunkSize);
          var offset = 0;
          var uploadId = "";
          //To-Do: Handle Resume and Pause
          for (let i = 0; i < chunks.length; i++) {
            const response = await uploadChunk(chunks[offset / chunkSize], uploadId, offset);
            if ("data" in response) {
              offset = response.data.offset;
              uploadId = response.data.upload_id;
            }
            //To-Do: Handle Error
            if (chunks[offset / chunkSize]) {
              currentUploadedFileSize += chunks[offset / chunkSize].size;
            } else {
              currentUploadedFileSize += file.size - (currentUploadedFileSize - currentUploadedFileSizeStartValue);
            }
            setCurrentSize(currentUploadedFileSize);
          }

          uploadFinished(file, uploadId);
        } else {
          console.log("File already uploaded");
          currentUploadedFileSize += file.size;
          setCurrentSize(currentUploadedFileSize);
        }
      }
    },
  });

  useEffect(() => {
    console.log("total size: " + totalSize);
  }, [totalSize]);

  useEffect(() => {
    console.log("current size: " + currentSize);
  }, [currentSize]);

  const calculateMD5 = async (file: File) => {
    const temporaryFileReader = new FileReader();
    return new Promise<string>((resolve, reject) => {
      temporaryFileReader.onerror = () => {
        temporaryFileReader.abort();
        reject(new DOMException("Problem parsing input file."));
      };

      temporaryFileReader.onload = () => {
        if (temporaryFileReader.result) {
          const hash = CryptoJS.MD5(
            // @ts-ignore
            CryptoJS.enc.Latin1.parse(temporaryFileReader.result)
          );
          resolve(hash.toString(CryptoJS.enc.Hex));
        }
      };
      temporaryFileReader.readAsBinaryString(file);
    });
  };

  const calculateMD5Blob = (blob: Blob) => {
    const reader = new FileReader();
    reader.readAsArrayBuffer(blob);
    reader.onload = () => {
      const buffer = reader.result;
      // @ts-ignore
      const md5 = MD5(buffer).toString();
      return md5;
    };
    return "";
  };

  const uploadExists = async (hash: string) => {
    return dispatch(api.endpoints.uploadExists.initiate(hash));
  };

  const uploadFinished = async (file: File, uploadId: string) => {
    const form_data = new FormData();
    form_data.append("upload_id", uploadId ? uploadId : "");
    form_data.append("md5", await calculateMD5(file));
    form_data.append("user", userSelfDetails.id.toString());
    form_data.append("filename", file.name);
    Server.post("/upload/complete/", form_data);
  };

  const uploadChunk = async (chunk: Blob, uploadId: string, offset: number) => {
    //only send first chunk without upload id
    var form_data = new FormData();
    if (uploadId) {
      form_data.append("upload_id", uploadId);
    }
    form_data.append("file", chunk);
    form_data.append("md5", calculateMD5Blob(chunk));
    form_data.append("offset", offset.toString());
    form_data.append("user", userSelfDetails.id.toString());
    return dispatch(
      api.endpoints.upload.initiate({
        form_data: form_data,
        offset: offset,
        chunk_size: chunk.size,
      })
    );
  };

  const calculateChunks = (file: File, chunkSize: number) => {
    const chunks = Math.ceil(file.size / chunkSize);
    const chunk = [];
    for (let i = 0; i < chunks; i++) {
      const chunkEnd = Math.min((i + 1) * chunkSize, file.size);
      chunk.push(file.slice(i * chunkSize, chunkEnd));
    }
    return chunk;
  };
  if (siteSettings.allow_upload) {
    return (
      <div style={{ width: "50px" }}>
        <div {...getRootProps({ className: "dropzone" })}>
          <input {...getInputProps()} />
          {currentSize / totalSize > 0.99 && (
            <Button icon="upload" loading={currentSize / totalSize < 1} onClick={open}></Button>
          )}

          {currentSize / totalSize < 1 && (
            <Progress
              percent={((currentSize / totalSize) * 100).toFixed(0)}
              progress
              style={{
                width: "100%",
                margin: "0",
                marginTop: "5px",
              }}
            />
          )}
        </div>
      </div>
    );
  } else {
    return <div></div>;
  }
};
