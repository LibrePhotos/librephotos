import {
  Avatar,
  Badge,
  Box,
  Card,
  Group,
  Paper,
  RemoveScroll,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconMoodSmile, IconUser, IconUserQuestion } from "@tabler/icons-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";
import { useClusterFacesQuery } from "../../api_client/faces/hooks/useClusterFacesQuery";
import { serverAddress } from "../../api_client/urls";
import {
  FACE_CLUSTER_CANVAS_COLORS,
  FACE_CLUSTER_UNKNOWN_COLOR,
  faceClusterUnknownFill,
} from "../../theme/chartColors";
import { ListEmptyState } from "../common/ListEmptyState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { Lightbox } from "../lightbox";
import classes from "./FaceClusterGraph.module.css";
import { findPointNear, getColorForPerson, type FacePoint } from "./faceClusterPoints";

type Props = Readonly<{
  height: number;
}>;

type PersonStat = { count: number; color: string; face_url: string; person_id: number };

// Extract photo hash from face_url (format: /media/faces/{image_hash}_{face_index}_{suffix}.jpg)
function extractPhotoHashFromFaceUrl(faceUrl: string): string | null {
  if (!faceUrl) return null;
  // face_url format: /media/faces/bb6685821c52c994cf7bbe9ebfd5eb7e1_2_fpZqB0S.jpg
  const match = faceUrl.match(/\/media\/faces\/([a-f0-9]+)_/);
  return match?.[1] ?? null;
}

/** The graph's title and what it shows, above the graph and above its empty or error state. */
function ClusterGraphTitle() {
  const { t } = useTranslation();
  return (
    <div>
      <Title order={3}>{t("facecluster")}</Title>
      <Text c="dimmed" size="sm">
        {t("faceclusterexplanation")}
      </Text>
    </div>
  );
}

export function FaceClusterGraph({ height }: Props) {
  const [hoveredPoint, setHoveredPoint] = useState<FacePoint | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [lightboxOpen, { open: openLightbox, close: hideLightbox }] = useDisclosure(false);
  const [lightboxImageId, setLightboxImageId] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme();
  const isDark = colorScheme === "dark";

  const { observe: observeChange, width } = useDimensions({
    onResize: ({ observe }) => observe(),
  });

  const clusterQuery = useClusterFacesQuery();
  const { data: facesVis, isFetching: clustering, isSuccess: clustered } = clusterQuery;
  const listFailure = useListFailure(clusterQuery);

  // Process data and assign colors
  const { points, personStats, bounds } = useMemo(() => {
    if (!facesVis?.data || facesVis.data.length === 0) {
      return {
        points: [],
        personStats: new Map<string, PersonStat>(),
        bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
      };
    }

    const allPoints: FacePoint[] = [];
    const stats = new Map<string, PersonStat>();

    // Get unique person names (excluding unknown first for color assignment)
    const uniqueNames = [...new Set(facesVis.data.map(el => el.person_name))];
    const knownNames = uniqueNames.filter(n => n !== "unknown");
    const nameColorMap = new Map<string, string>();

    knownNames.forEach((name, index) => {
      nameColorMap.set(name, getColorForPerson(name, index));
    });
    nameColorMap.set("unknown", getColorForPerson("unknown", 0));

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    facesVis.data.forEach(el => {
      const color = nameColorMap.get(el.person_name) || FACE_CLUSTER_UNKNOWN_COLOR;
      const photoHash = extractPhotoHashFromFaceUrl(el.face_url);
      const point: FacePoint = {
        x: el.value.x,
        y: el.value.y,
        size: el.value.size,
        name: el.person_name,
        color,
        face_url: el.face_url,
        photo: photoHash || "",
        person_id: el.person_id,
      };
      allPoints.push(point);

      // Update bounds
      minX = Math.min(minX, el.value.x);
      maxX = Math.max(maxX, el.value.x);
      minY = Math.min(minY, el.value.y);
      maxY = Math.max(maxY, el.value.y);

      // Update stats
      const stat = stats.get(el.person_name);
      if (stat) {
        stat.count += 1;
      } else {
        stats.set(el.person_name, {
          count: 1,
          color,
          face_url: el.face_url,
          person_id: el.person_id,
        });
      }
    });

    // Add padding to bounds
    const padX = (maxX - minX) * 0.05;
    const padY = (maxY - minY) * 0.05;

    return {
      points: allPoints,
      personStats: stats,
      bounds: {
        minX: minX - padX,
        maxX: maxX + padX,
        minY: minY - padY,
        maxY: maxY + padY,
      },
    };
  }, [facesVis]);

  // Convert data coordinates to canvas coordinates
  const toCanvasCoords = useCallback(
    (x: number, y: number, canvasWidth: number, canvasHeight: number) => {
      const { minX, maxX, minY, maxY } = bounds;
      const scaleX = canvasWidth / (maxX - minX);
      const scaleY = canvasHeight / (maxY - minY);
      return {
        cx: (x - minX) * scaleX,
        cy: canvasHeight - (y - minY) * scaleY, // Flip Y axis
      };
    },
    [bounds]
  );

  // Calculate actual canvas dimensions
  const canvasWidth = Math.max(0, width - 30);
  const canvasHeight = Math.max(0, height - 120);

  // Setup and draw canvas - combined to avoid race conditions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0 || canvasWidth <= 0 || canvasHeight <= 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    // Setup canvas dimensions
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    // Clear canvas and set scale
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    // Draw grid
    ctx.strokeStyle = isDark ? FACE_CLUSTER_CANVAS_COLORS.grid.dark : FACE_CLUSTER_CANVAS_COLORS.grid.light;
    ctx.lineWidth = 1;

    const gridSize = 50;
    for (let x = 0; x < canvasWidth; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }
    for (let y = 0; y < canvasHeight; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }

    // Sort points: draw unknown first (background), then known people
    const sortedPoints = [...points].sort((a, b) => {
      if (a.name === "unknown" && b.name !== "unknown") return -1;
      if (a.name !== "unknown" && b.name === "unknown") return 1;
      // If filtering by person, draw selected person last
      if (selectedPerson) {
        if (a.name === selectedPerson && b.name !== selectedPerson) return 1;
        if (a.name !== selectedPerson && b.name === selectedPerson) return -1;
      }
      return 0;
    });

    // Draw points
    sortedPoints.forEach(point => {
      const { cx, cy } = toCanvasCoords(point.x, point.y, canvasWidth, canvasHeight);
      const isFiltered = selectedPerson && point.name !== selectedPerson;
      const isSelected = selectedPerson === point.name;
      const isUnknown = point.name === "unknown";

      let radius = isUnknown ? 3 : 5;
      let alpha = 1;

      if (isFiltered) {
        alpha = 0.1;
        radius = 2;
      } else if (isSelected) {
        radius = 7;
      }

      // Glow effect for known faces
      if (!isUnknown && !isFiltered) {
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2);
        gradient.addColorStop(0, point.color);
        gradient.addColorStop(0.5, `${point.color}80`);
        gradient.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 2, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Main dot
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle =
        isFiltered && !isUnknown ? `${point.color}40` : isUnknown ? faceClusterUnknownFill(alpha * 0.3) : point.color;
      ctx.fill();

      // Border for known faces
      if (!isUnknown && !isFiltered) {
        ctx.strokeStyle = isDark
          ? FACE_CLUSTER_CANVAS_COLORS.pointBorder.dark
          : FACE_CLUSTER_CANVAS_COLORS.pointBorder.light;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });

    // Reset transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [points, bounds, toCanvasCoords, selectedPerson, isDark, canvasWidth, canvasHeight]);

  // Handle mouse move for hover detection
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || points.length === 0 || canvasWidth <= 0 || canvasHeight <= 0) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setMousePos({ x: e.clientX, y: e.clientY });

      setHoveredPoint(
        findPointNear(points, mouseX, mouseY, selectedPerson, point =>
          toCanvasCoords(point.x, point.y, canvasWidth, canvasHeight)
        )
      );
    },
    [points, selectedPerson, toCanvasCoords, canvasWidth, canvasHeight]
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredPoint(null);
  }, []);

  // Handle click to open lightbox - find point directly on click to avoid race conditions
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || points.length === 0 || canvasWidth <= 0 || canvasHeight <= 0) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const clickedPoint = findPointNear(points, mouseX, mouseY, selectedPerson, point =>
        toCanvasCoords(point.x, point.y, canvasWidth, canvasHeight)
      );

      if (clickedPoint && clickedPoint.photo) {
        setLightboxImageId(clickedPoint.photo);
        openLightbox();
      }
    },
    [points, selectedPerson, toCanvasCoords, canvasWidth, canvasHeight, openLightbox]
  );

  const closeLightbox = useCallback(() => {
    hideLightbox();
    setLightboxImageId("");
  }, [hideLightbox]);

  const handleLightboxImageChange = useCallback((imageId: string) => {
    setLightboxImageId(imageId);
  }, []);

  // Create idx2hash for lightbox navigation (unique photos only)
  const idx2hash = useMemo(() => {
    const uniquePhotos = new Map<string, { id: string; image_hash: string }>();
    points.forEach(point => {
      if (point.photo && !uniquePhotos.has(point.photo)) {
        // point.photo is the image_hash extracted from face_url
        // Use it for both id and image_hash since we're working with legacy hash-based data
        uniquePhotos.set(point.photo, { id: point.photo, image_hash: point.photo });
      }
    });
    return Array.from(uniquePhotos.values());
  }, [points]);

  // Sort person stats for legend
  const sortedPersonStats = useMemo(() => {
    const entries = Array.from(personStats.entries());
    return entries.filter(([name]) => name !== "unknown").sort((a, b) => b[1].count - a[1].count);
  }, [personStats]);

  const unknownCount = personStats.get("unknown")?.count || 0;
  const hasData = points.length > 0;

  if (clustering) {
    return <PageLoader label={t("faceclusterloading")} />;
  }

  if (clustered && hasData) {
    return (
      <RemoveScroll enabled={lightboxOpen}>
        <Stack ref={observeChange} gap="md">
          <ClusterGraphTitle />

          {/* Legend */}
          {/* Natural width, so a long row scrolls instead of squeezing the chips to "A…";
              the scrollbar always shows, as touch screens have no hover */}
          <ScrollArea type="auto" offsetScrollbars>
            <Group gap="xs" wrap="nowrap" w="max-content">
              <Badge
                variant={selectedPerson === null ? "filled" : "light"}
                color="gray"
                size="lg"
                tt="none"
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedPerson(null)}
                leftSection={<IconUser size={14} />}
              >
                {t("all")} ({points.length})
              </Badge>
              {sortedPersonStats.slice(0, 15).map(([name, stat]) => (
                <Tooltip
                  key={name}
                  label={
                    <Group gap="xs">
                      <Avatar src={serverAddress + stat.face_url} radius="xl" size="sm" />
                      <Text size="sm">{t("statistics.facecount", { name, count: stat.count })}</Text>
                    </Group>
                  }
                  withArrow
                >
                  <Badge
                    variant={selectedPerson === name ? "filled" : "light"}
                    style={{
                      cursor: "pointer",
                      backgroundColor: selectedPerson === name ? stat.color : `${stat.color}20`,
                      color: selectedPerson === name ? "white" : stat.color,
                      borderColor: stat.color,
                    }}
                    size="lg"
                    // Names keep their own case
                    tt="none"
                    onClick={() => setSelectedPerson(selectedPerson === name ? null : name)}
                  >
                    {name}
                  </Badge>
                </Tooltip>
              ))}
              {unknownCount > 0 && (
                <Badge
                  variant={selectedPerson === "unknown" ? "filled" : "light"}
                  color="gray"
                  size="lg"
                  tt="none"
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedPerson(selectedPerson === "unknown" ? null : "unknown")}
                  leftSection={<IconUserQuestion size={14} />}
                >
                  {t("settings.unknown")} ({unknownCount})
                </Badge>
              )}
            </Group>
          </ScrollArea>

          {/* Canvas */}
          <Box ref={containerRef} className={classes.canvasBox}>
            <canvas
              ref={canvasRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onClick={handleCanvasClick}
              style={{ cursor: hoveredPoint ? "pointer" : "default" }}
            />

            {/* Hover tooltip */}
            {hoveredPoint && (
              <Paper
                shadow="xl"
                p="sm"
                radius="md"
                style={{
                  position: "fixed",
                  left: mousePos.x + 15,
                  top: mousePos.y - 60,
                  zIndex: 1000,
                  pointerEvents: "none",
                  backdropFilter: "blur(8px)",
                  background: isDark ? "var(--app-chart-tooltip-dark)" : "var(--app-scrim-white-95)",
                  border: `2px solid ${hoveredPoint.color}`,
                }}
              >
                <Group gap="sm" wrap="nowrap">
                  <Avatar
                    src={serverAddress + hoveredPoint.face_url}
                    size={60}
                    radius="md"
                    style={{
                      border: `2px solid ${hoveredPoint.color}`,
                      boxShadow: `0 0 12px ${hoveredPoint.color}50`,
                    }}
                  />
                  <Stack gap={4}>
                    <Text fw={600} size="sm" style={{ color: hoveredPoint.color }}>
                      {hoveredPoint.name === "unknown" ? t("settings.unknown") : hoveredPoint.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("clicktoview")}
                    </Text>
                  </Stack>
                </Group>
              </Paper>
            )}
          </Box>

          {/* Stats */}
          <Group gap="xl" justify="center">
            <Card padding="xs" radius="md" withBorder>
              <Group gap="xs">
                <IconUser size={16} style={{ opacity: 0.6 }} />
                <Text size="sm" c="dimmed">
                  {t("identifiedpeople")}:
                </Text>
                <Text size="sm" fw={600}>
                  {sortedPersonStats.length}
                </Text>
              </Group>
            </Card>
            <Card padding="xs" radius="md" withBorder>
              <Group gap="xs">
                <IconMoodSmile size={16} style={{ opacity: 0.6 }} />
                <Text size="sm" c="dimmed">
                  {t("totalfaces")}:
                </Text>
                <Text size="sm" fw={600}>
                  {points.length}
                </Text>
              </Group>
            </Card>
          </Group>

          {/* Lightbox for viewing photos */}
          {lightboxOpen && (
            <Lightbox
              isPublic={false}
              idx2hash={idx2hash}
              selectedImage={lightboxImageId}
              onChangedIndex={() => {}}
              onCloseRequest={closeLightbox}
              onImageChange={handleLightboxImageChange}
            />
          )}
        </Stack>
      </RemoveScroll>
    );
  }

  return (
    <Stack ref={observeChange}>
      <ClusterGraphTitle />
      <ListEmptyState
        failure={listFailure}
        icon={<IconMoodSmile size={40} />}
        title={t("emptystate.faces.title")}
        description={t("emptystate.faces.description")}
        actionLabel={t("emptystate.goToLibrary")}
        actionLink="/library"
      />
    </Stack>
  );
}
