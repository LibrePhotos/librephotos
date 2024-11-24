import { ActionIcon, Progress } from "@mantine/core";
import { IconUpload as Upload } from "@tabler/icons-react";
import CryptoJS from "crypto-js";
import MD5 from "crypto-js/md5";
import React, { useState } from "react";
import { useDropzone } from "react-dropzone";

import { api } from "../api_client/api";
import { useGetSettingsQuery } from "../api_client/site-settings";
import { useAppDispatch, useAppSelector } from "../store/store";

export function ChunkedUploadButton() {
  const [totalSize, setTotalSize] = useState(1);
  const [currentSize, setCurrentSize] = useState(1);
  const { userSelfDetails } = useAppSelector(state => state.user);
  const { data: settings } = useGetSettingsQuery();
  const dispatch = useAppDispatch();
  const chunkSize = 1000000; // < 1MB chunks, because of default of nginx

  let currentUploadedFileSize = 0;

  const calculateMD5 = async (file: File) => {
    const temporaryFileReader = new FileReader();
    const fileSize = file.size;
    const blockSize = 25 * 1024 * 1024; // 25MB
    let offset = 0;
    const md5 = CryptoJS.algo.MD5.create();
    return new Promise<string>((resolve, reject) => {
      function readNext() {
        const fileSlice = file.slice(offset, offset + blockSize);
        temporaryFileReader.readAsBinaryString(fileSlice);
      }

      temporaryFileReader.onerror = () => {
        temporaryFileReader.abort();
        reject(new DOMException("Problem parsing input file."));
      };

      temporaryFileReader.onload = () => {
        if (temporaryFileReader.result) {
          // @ts-ignore
          offset += temporaryFileReader.result.length;

          md5.update(
            // @ts-ignore
            CryptoJS.enc.Latin1.parse(temporaryFileReader.result)
          );
          if (offset >= fileSize) {
            resolve(md5.finalize().toString(CryptoJS.enc.Hex));
          }
          readNext();
        }
      };

      readNext();
    });
  };

  const checkIfAlreadyUploaded = async (hash: string) =>
    dispatch(api.endpoints.uploadExists.initiate(hash + userSelfDetails.id)).then(r => r.data);

  const uploadFinished = async (file: File, uploadId: string) => {
    const formData = new FormData();
    formData.append("upload_id", uploadId);
    formData.append("md5", await calculateMD5(file));
    formData.append("user", userSelfDetails.id.toString());
    formData.append("filename", file.name);
    dispatch(api.endpoints.uploadFinished.initiate(formData));
  };

  const calculateMD5Blob = async (blob: Blob) => {
    const reader = new FileReader();
    reader.readAsArrayBuffer(blob);
    reader.onload = () => {
      const buffer = reader.result;
      // @ts-ignore
      return MD5(buffer).toString();
    };
    return "";
  };

  const uploadChunk = async (chunk: Blob, uploadId: string, offset: number) => {
    // only send first chunk without upload id
    const formData = new FormData();
    if (uploadId) {
      formData.append("upload_id", uploadId);
    }
    formData.append("file", chunk);
    // FIX-ME: This is empty
    formData.append("md5", await calculateMD5Blob(chunk));
    formData.append("offset", offset.toString());
    formData.append("user", userSelfDetails.id.toString());
    return dispatch(
      api.endpoints.upload.initiate({
        form_data: formData,
        offset,
        chunk_size: chunk.size,
      })
    );
  };

  const calculateChunks = (file: File, blockSize: number) => {
    const chunks = Math.ceil(file.size / blockSize);
    const chunk = [] as Blob[];
    for (let i = 0; i < chunks; i += 1) {
      const chunkEnd = Math.min((i + 1) * blockSize, file.size);
      chunk.push(file.slice(i * blockSize, chunkEnd));
    }
    return chunk;
  };

  async function uploadFile(file: File) {
    const currentUploadedFileSizeStartValue = currentUploadedFileSize;
    let offset = 0;
    let uploadId = "";
    const chunks = calculateChunks(file, chunkSize);
    // To-Do: Handle Resume and Pause
    // eslint-disable-next-line no-restricted-syntax
    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      const response = await uploadChunk(chunk, uploadId, offset);
      if ("data" in response) {
        offset = response.data.offset;
        uploadId = response.data.upload_id;
      }
      // To-Do: Handle Error
      if (chunk.size) {
        currentUploadedFileSize += chunk.size;
      } else {
        currentUploadedFileSize += file.size - (currentUploadedFileSize - currentUploadedFileSizeStartValue);
      }
      setCurrentSize(currentUploadedFileSize);
    }
    await uploadFinished(file, uploadId);
  }

  function onDrop(acceptedFiles: File[]) {
    setTotalSize(acceptedFiles.reduce((acc, file) => acc + file.size, 0));
    acceptedFiles.forEach(file => {
      calculateMD5(file)
        .then(checkIfAlreadyUploaded)
        .then(async foundOnServer => {
          if (!foundOnServer) {
            await uploadFile(file);
          } else {
            setCurrentSize(currentUploadedFileSize + file.size);
          }
        });
    });
  }

  const { getRootProps, getInputProps, open } = useDropzone({
    accept: {
      "image/*": [],
      "video/*": [],
    },
    noClick: true,
    noKeyboard: true,
    onDrop,
  });

  if (settings?.allow_upload) {
    return (
      <div style={{ width: "50px" }}>
        <div {...getRootProps({ className: "dropzone" })} style={{ alignContent: "center", display: "flex" }}>
          <input {...getInputProps()} />
          {currentSize / totalSize > 0.99 && (
            <ActionIcon color="gray" variant="light" loading={currentSize / totalSize < 1} onClick={open}>
              <Upload />
            </ActionIcon>
          )}

          {currentSize / totalSize < 1 && (
            <Progress
              value={(currentSize / totalSize) * 100}
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
  }
  return null;
}
