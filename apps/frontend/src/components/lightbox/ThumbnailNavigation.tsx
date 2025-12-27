import { Box, Group, Skeleton } from "@mantine/core";
import React from "react";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks/useFetchPhotoDetailsQuery";
import { Tile } from "../Tile";

export type ThumbnailNavigationProps = {
  prevSrc: string | null;
  prevSrcHash: string | null;
  mainSrcHash: string;
  nextSrc: string | null;
  nextSrcHash: string | null;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
};

export function ThumbnailNavigation({
  prevSrc,
  prevSrcHash,
  mainSrcHash,
  nextSrc,
  nextSrcHash,
  onMovePrevRequest,
  onMoveNextRequest,
}: ThumbnailNavigationProps) {
  // Use image_hash for API calls since backend still uses image_hash for lookup
  const { data: prevPhotoDetail, isLoading: isPrevPhotoDetailLoading } = useFetchPhotoDetailsQuery(prevSrcHash ?? "");
  const { data: mainPhotoDetail, isLoading: isMainPhotoDetailLoading } = useFetchPhotoDetailsQuery(mainSrcHash);
  const { data: nextPhotoDetail, isLoading: isNextPhotoDetailLoading } = useFetchPhotoDetailsQuery(nextSrcHash ?? "");

  return (
    <div
      style={{
        height: "80px",
        marginTop: "12px",
        overflow: "visible",
        position: "absolute",
        bottom: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",
        background: "rgba(0,0,0,0.2)",
        padding: "8px 0",
        borderRadius: "8px",
        boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
        margin: "0 auto",
        width: "fit-content",
        minWidth: "240px",
        maxWidth: "80%",
        transition: "transform 0.25s ease-in-out, max-width 0.25s ease-in-out",
      }}
    >
      <Group justify="center" align="center" style={{ height: "100%" }}>
        {prevSrc && (
          <Box
            onClick={onMovePrevRequest}
            style={{
              cursor: "pointer",
              opacity: 0.85,
              transition: "all 0.2s ease",
              transform: "scale(0.85) translateX(10px)",
              boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
              width: "64px",
              height: "64px",
            }}
            onMouseOver={e => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.transform = "scale(0.9) translateX(10px)";
              e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.4)";
            }}
            onMouseOut={e => {
              e.currentTarget.style.opacity = "0.85";
              e.currentTarget.style.transform = "scale(0.85) translateX(10px)";
              e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.3)";
            }}
          >
            {isPrevPhotoDetailLoading ? (
              <Skeleton height={64} width={64} />
            ) : (
              <Tile
                image_hash={prevSrcHash || ""}
                width={64}
                height={64}
                video={prevPhotoDetail?.video}
                style={{
                  border: "2px solid rgba(255,255,255,0.6)",
                  borderRadius: "8px",
                  overflow: "hidden",
                  backgroundColor: "rgba(0,0,0,0.3)",
                  width: "100%",
                  height: "100%",
                }}
              />
            )}
          </Box>
        )}

        <Box
          style={{
            marginLeft: "8px",
            marginRight: "8px",
            boxShadow: "0 0 12px rgba(255,255,255,0.3), 0 4px 8px rgba(0,0,0,0.5)",
            backgroundColor: "rgba(0,0,0,0.3)",
            zIndex: 1,
            width: "72px",
            height: "72px",
          }}
        >
          {isMainPhotoDetailLoading ? (
            <Skeleton height={72} width={72} />
          ) : (
            <Tile
              image_hash={mainSrcHash}
              width={72}
              height={72}
              video={mainPhotoDetail?.video}
              style={{
                border: "3px solid #fff",
                borderRadius: "8px",
                overflow: "hidden",
                width: "100%",
                height: "100%",
              }}
            />
          )}
        </Box>

        {nextSrc && (
          <Box
            onClick={onMoveNextRequest}
            style={{
              cursor: "pointer",
              opacity: 0.85,
              transition: "all 0.2s ease",
              transform: "scale(0.85) translateX(-10px)",
              boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
              width: "64px",
              height: "64px",
            }}
            onMouseOver={e => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.transform = "scale(0.9) translateX(-10px)";
              e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.4)";
            }}
            onMouseOut={e => {
              e.currentTarget.style.opacity = "0.85";
              e.currentTarget.style.transform = "scale(0.85) translateX(-10px)";
              e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.3)";
            }}
          >
            {isNextPhotoDetailLoading ? (
              <Skeleton height={64} width={64} />
            ) : (
              <Tile
                image_hash={nextSrcHash || ""}
                width={64}
                height={64}
                video={nextPhotoDetail?.video}
                style={{
                  border: "2px solid rgba(255,255,255,0.6)",
                  borderRadius: "8px",
                  overflow: "hidden",
                  backgroundColor: "rgba(0,0,0,0.3)",
                  width: "100%",
                  height: "100%",
                }}
              />
            )}
          </Box>
        )}
      </Group>
    </div>
  );
}
