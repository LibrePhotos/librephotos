import { ActionIcon, Progress } from "@mantine/core";
import CryptoJS from "crypto-js";
import MD5 from "crypto-js/md5";
import React, { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload } from "tabler-icons-react";

import { scanUploadedPhotos } from "../actions/photosActions";
import { fetchSiteSettings } from "../actions/utilActions";
import { api } from "../api_client/api";
import { useAppDispatch, useAppSelector } from "../store/store";
import { selectSiteSettings } from "../store/util/utilSelectors";

export function ChunkedUploadButton() {
  const [totalSize, setTotalSize] = useState(1);
  const [currentSize, setCurrentSize] = useState(1);
  const { userSelfDetails } = useAppSelector(state => state.user);
  const siteSettings = useAppSelector(selectSiteSettings);
  const dispatch = useAppDispatch();
  const chunkSize = 1000000; // < 1MB chunks, because of default of nginx

  useEffect(() => {
    fetchSiteSettings(dispatch);
  }, [dispatch]);
  let currentUploadedFileSize = 0;

  const calculateMD5 = async (file: File) => {
    const temporaryFileReader = new FileReader();
    const fileSize = file.size;
    const chunkSize = 25 * 1024 * 1024; // 25MB
    let offset = 0;
    const md5 = CryptoJS.algo.MD5.create();
    return new Promise<string>((resolve, reject) => {
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
      function readNext() {
        const fileSlice = file.slice(offset, offset + chunkSize);
        temporaryFileReader.readAsBinaryString(fileSlice);
      }
      readNext();
    });
  };

  const uploadExists = async (hash: string) => dispatch(api.endpoints.uploadExists.initiate(hash));

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
      const md5 = MD5(buffer).toString();
      return md5;
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
        offset: offset,
        chunk_size: chunk.size,
      })
    );
  };

  const calculateChunks = (file: File, chunkSize: number) => {
    const chunks = Math.ceil(file.size / chunkSize);
    const chunk = [] as Blob[];
    for (let i = 0; i < chunks; i++) {
      const chunkEnd = Math.min((i + 1) * chunkSize, file.size);
      chunk.push(file.slice(i * chunkSize, chunkEnd));
    }
    return chunk;
  };

  const { getRootProps, getInputProps, open } = useDropzone({
    accept: {
      "image/*": [],
      "video/*": [],
    },
    noClick: true,
    noKeyboard: true,
    onDrop: async acceptedFiles => {
      let totalSize = 0;
      acceptedFiles.forEach(file => {
        const fileSize = file.size;
        totalSize += fileSize;
      });
      setTotalSize(totalSize);
      for (const file of acceptedFiles) {
        const currentUploadedFileSizeStartValue = currentUploadedFileSize;
        // Check if the upload already exists via the hash of the file
        const hash = (await calculateMD5(file)) + userSelfDetails.id;
        const isAlreadyUploaded = (await uploadExists(hash)).data;
        let offset = 0;
        let uploadId = "";
        if (!isAlreadyUploaded) {
          const chunks = calculateChunks(file, chunkSize);
          // To-Do: Handle Resume and Pause
          for (let i = 0; i < chunks.length; i++) {
            const response = await uploadChunk(chunks[offset / chunkSize], uploadId, offset);
            if ("data" in response) {
              offset = response.data.offset;
              uploadId = response.data.upload_id;
            }
            // To-Do: Handle Error
            if (chunks[offset / chunkSize]) {
              currentUploadedFileSize += chunks[offset / chunkSize].size;
            } else {
              currentUploadedFileSize += file.size - (currentUploadedFileSize - currentUploadedFileSizeStartValue);
            }
            setCurrentSize(currentUploadedFileSize);
          }
          uploadFinished(file, uploadId);
        } else {
          currentUploadedFileSize += file.size;
          setCurrentSize(currentUploadedFileSize);
        }
      }
      dispatch(scanUploadedPhotos());
    },
  });

  useEffect(() => {}, [totalSize]);

  useEffect(() => {}, [currentSize]);

  if (siteSettings.allow_upload) {
    return (
      <div style={{ width: "50px" }}>
        <div {...getRootProps({ className: "dropzone" })}>
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
