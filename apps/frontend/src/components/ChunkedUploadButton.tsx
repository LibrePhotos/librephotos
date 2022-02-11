import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../hooks";
import { useDropzone } from "react-dropzone";
import { Button, Progress } from "semantic-ui-react";
import { Server } from "../api_client/apiClient";
import MD5 from "crypto-js/md5";
import CryptoJS from "crypto-js";

export const ChunkedUploadButton = ({ token }: { token?: string }) => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  var [totalSize, setTotalSize] = useState(1);
  var [currentSize, setCurrentSize] = useState(1);
  const { userSelfDetails } = useAppSelector((state) => state.user);
  const chunkSize = 100000; // 100kb chunks
  const { getRootProps, getInputProps, open, acceptedFiles } = useDropzone({
    accept: ["image/*", "video/*"],
    noClick: true,
    noKeyboard: true,
    onDrop: (acceptedFiles) => {
      var totalSize = 0;
      acceptedFiles.forEach((file) => {
        const fileSize = file.size;
        totalSize += fileSize;
      });
      setTotalSize(totalSize);
      var localCurrentSize = 0;
      acceptedFiles.forEach(async (file) => {
        // Check if the upload already exists via the hash of the file
        const hash = (await calculateMD5(file)) + userSelfDetails.id;
        //const isAlreadyUploaded = await uploadExists(hash);
        //if (!isAlreadyUploaded) {
        if (true) {
          const chunks = calculateChunks(file, chunkSize);
          var offset = 0;
          var uploadId = "";
          for (let i = 0; i < chunks.length; i++) {
            var response = await uploadChunk(
              chunks[offset / chunkSize],
              uploadId,
              offset
            );
            offset = response.offset;
            uploadId = response.uploadId;
            if (chunks[offset / chunkSize]) {
              localCurrentSize += chunks[offset / chunkSize].size;
            } else {
              localCurrentSize = file.size;
            }
            setCurrentSize(localCurrentSize);
          }
          uploadFinished(file, uploadId);
        }
      });
      // To-Do: forget accepted files after onDrop...
      // To-Do: Do the uploads one after another and not in parallel
    },
  });

  useEffect(() => {
    console.log("total size: " + totalSize);
  }, [totalSize]);

  useEffect(() => {
    console.log("current size: " + currentSize);
  }, [currentSize]);

  const calculateMD5 = (file: File) => {
    var temporaryFileReader = new FileReader();
    return new Promise<string>((resolve, reject) => {
      temporaryFileReader.onerror = () => {
        temporaryFileReader.abort();
        reject(new DOMException("Problem parsing input file."));
      };

      temporaryFileReader.onload = () => {
        if (temporaryFileReader.result) {
          var hash = CryptoJS.MD5(
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
    const query = "/upload/exists/" + hash;
    return Server.get(query).then((response) => {
      return response.data.exists;
    });
  };

  const uploadFinished = async (file: File, uploadId: string) => {
    const form_data = new FormData();
    form_data.append("upload_id", uploadId ? uploadId : "");
    form_data.append("md5", await calculateMD5(file));
    form_data.append("user", userSelfDetails.id);
    form_data.append("filename", file.name);
    Server.post("/upload/complete/", form_data);
  };

  const uploadChunk = (chunk: Blob, uploadId: string, offset: number) => {
    if (!uploadId) {
      var form_data = new FormData();
      //only send first chunk without upload id
      form_data.append("file", chunk);
      form_data.append("md5", calculateMD5Blob(chunk));
      form_data.append("offset", offset.toString());
      form_data.append("user", userSelfDetails.id);
      return Server.post("upload/", form_data, {
        headers: {
          "Content-Type": "multipart/form-data",
          "Content-Range": `bytes ${offset}-${offset + chunk.size - 1}/${
            chunk.size
          }`,
        },
      }).then((response) => {
        return {
          uploadId: response.data.upload_id,
          offset: response.data.offset,
        };
      });
    }
    var form_data = new FormData();
    form_data.append("upload_id", uploadId);
    form_data.append("file", chunk);
    form_data.append("md5", calculateMD5Blob(chunk));
    form_data.append("offset", offset.toString());
    form_data.append("user", userSelfDetails.id);
    return Server.post("upload/", form_data, {
      headers: {
        "Content-Type": "multipart/form-data",
        "Content-Range": `bytes ${offset}-${offset + chunk.size - 1}/${
          chunk.size
        }`,
      },
    }).then((response) => {
      return {
        uploadId: response.data.upload_id,
        offset: response.data.offset,
      };
    });
  };

  const calculateChunks = (file: File, chunkSize: number) => {
    const chunks = Math.ceil(file.size / chunkSize);
    const chunk = [];
    for (let i = 0; i < chunks; i++) {
      var chunkEnd = Math.min((i + 1) * chunkSize, file.size);
      chunk.push(file.slice(i * chunkSize, chunkEnd));
    }
    return chunk;
  };

  // to handle multiple files, queue them in the client and do them on after another
  return (
    <div style={{ width: "50px" }}>
      <div {...getRootProps({ className: "dropzone" })}>
        <input {...getInputProps()} />
        {currentSize / totalSize > 0.99 && (
          <Button
            icon="upload"
            loading={currentSize / totalSize < 1}
            onClick={open}
          ></Button>
        )}

        {
          //To-Do: make layout of progress bar prettier
          currentSize / totalSize < 1 && (
            <Progress
              percent={((currentSize / totalSize) * 100).toFixed(0)}
              progress
              style={{
                width: "100%",
                margin: "0",
                marginTop: "5px",
              }}
            />
          )
        }
      </div>
    </div>
  );
};
