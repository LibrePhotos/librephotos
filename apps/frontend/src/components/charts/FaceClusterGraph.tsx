import { IconMoodSmile, IconUser, IconUserQuestion } from "@tabler/icons-react";
import {
  Avatar,
  Badge,
  Box,
  Card,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import { RemoveScroll } from "@mantine/core";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";

import { serverAddress } from "../../api_client/apiClient";
import { useClusterFacesQuery } from "../../api_client/faces/hooks/useClusterFacesQuery";
import { EmptyState } from "../common/EmptyState";
import { Lightbox } from "../lightbox";

type Props = Readonly<{
  height: number;
}>;

type FacePoint = {
  x: number;
  y: number;
  size: number;
  name: string;
  color: string;
  face_url: string;
  photo: string;
  person_id: number;
};

// Extract photo hash from face_url (format: /media/faces/{image_hash}_{face_index}_{suffix}.jpg)
function extractPhotoHashFromFaceUrl(faceUrl: string): string | null {
  if (!faceUrl) return null;
  // face_url format: /media/faces/bb6685821c52c994cf7bbe9ebfd5eb7e1_2_fpZqB0S.jpg
  const match = faceUrl.match(/\/media\/faces\/([a-f0-9]+)_/);
  return match ? match[1] : null;
}

// Beautiful color palette for face clusters
const CLUSTER_COLORS = [
  "#FF6B6B", // Coral Red
  "#4ECDC4", // Teal
  "#45B7D1", // Sky Blue
  "#96CEB4", // Sage Green
  "#FFEAA7", // Soft Yellow
  "#DDA0DD", // Plum
  "#98D8C8", // Mint
  "#F7DC6F", // Sunflower
  "#BB8FCE", // Lavender
  "#85C1E9", // Light Blue
  "#F8B500", // Golden
  "#FF8C94", // Salmon
  "#A8E6CF", // Seafoam
  "#FFD93D", // Bright Yellow
  "#6BCB77", // Green
  "#4D96FF", // Royal Blue
  "#FF6B9D", // Pink
  "#C9B1FF", // Periwinkle
  "#FFB347", // Orange
  "#87CEEB", // Sky
];

function getColorForPerson(personName: string, index: number): string {
  if (personName === "unknown" || !personName) {
    return "rgba(100, 100, 100, 0.4)";
  }
  return CLUSTER_COLORS[index % CLUSTER_COLORS.length];
}

export function FaceClusterGraph({ height }: Props) {
  const [hoveredPoint, setHoveredPoint] = useState<FacePoint | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImageId, setLightboxImageId] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme();
  const isDark = colorScheme === "dark";

  const { observe: observeChange, width } = useDimensions({
    onResize: ({ observe }) => observe(),
  });

  const { data: facesVis, isFetching: clustering, isSuccess: clustered } = useClusterFacesQuery();

  // Process data and assign colors
  const { points, personStats, bounds } = useMemo(() => {
    if (!facesVis?.data || facesVis.data.length === 0) {
      return { points: [], personStats: new Map(), bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 } };
    }

    const allPoints: FacePoint[] = [];
    const stats = new Map<string, { count: number; color: string; face_url: string; person_id: number }>();
    
    // Get unique person names (excluding unknown first for color assignment)
    const uniqueNames = [...new Set(facesVis.data.map((el: any) => el.person_name))];
    const knownNames = uniqueNames.filter(n => n !== "unknown");
    const nameColorMap = new Map<string, string>();
    
    knownNames.forEach((name, index) => {
      nameColorMap.set(name as string, getColorForPerson(name as string, index));
    });
    nameColorMap.set("unknown", getColorForPerson("unknown", 0));

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    facesVis.data.forEach((el: any) => {
      const color = nameColorMap.get(el.person_name) || "rgba(100, 100, 100, 0.4)";
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
      if (!stats.has(el.person_name)) {
        stats.set(el.person_name, {
          count: 0,
          color,
          face_url: el.face_url,
          person_id: el.person_id,
        });
      }
      const stat = stats.get(el.person_name)!;
      stat.count += 1;
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

  // Convert canvas coordinates to data coordinates
  const toDataCoords = useCallback(
    (cx: number, cy: number, canvasWidth: number, canvasHeight: number) => {
      const { minX, maxX, minY, maxY } = bounds;
      const scaleX = (maxX - minX) / canvasWidth;
      const scaleY = (maxY - minY) / canvasHeight;
      return {
        x: cx * scaleX + minX,
        y: (canvasHeight - cy) * scaleY + minY,
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
    ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)";
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
    sortedPoints.forEach((point) => {
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
        gradient.addColorStop(0.5, point.color + "80");
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
        isFiltered && !isUnknown
          ? point.color + "40"
          : isUnknown
            ? `rgba(100, 100, 100, ${alpha * 0.3})`
            : point.color;
      ctx.fill();

      // Border for known faces
      if (!isUnknown && !isFiltered) {
        ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.3)" : "rgba(0, 0, 0, 0.2)";
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

      // Find closest point
      let closestPoint: FacePoint | null = null;
      let minDist = 20; // Detection radius in pixels

      points.forEach((point) => {
        if (selectedPerson && point.name !== selectedPerson) return;

        const { cx, cy } = toCanvasCoords(point.x, point.y, canvasWidth, canvasHeight);
        const dist = Math.sqrt((mouseX - cx) ** 2 + (mouseY - cy) ** 2);

        if (dist < minDist) {
          minDist = dist;
          closestPoint = point;
        }
      });

      setHoveredPoint(closestPoint);
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

      // Find clicked point
      let clickedPoint: FacePoint | null = null;
      let minDist = 20;

      points.forEach((point) => {
        if (selectedPerson && point.name !== selectedPerson) return;

        const { cx, cy } = toCanvasCoords(point.x, point.y, canvasWidth, canvasHeight);
        const dist = Math.sqrt((mouseX - cx) ** 2 + (mouseY - cy) ** 2);

        if (dist < minDist) {
          minDist = dist;
          clickedPoint = point;
        }
      });

      if (clickedPoint && clickedPoint.photo) {
        setLightboxImageId(clickedPoint.photo);
        setLightboxOpen(true);
      }
    },
    [points, selectedPerson, toCanvasCoords, canvasWidth, canvasHeight]
  );

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setLightboxImageId("");
  }, []);

  const handleLightboxImageChange = useCallback((imageId: string) => {
    setLightboxImageId(imageId);
  }, []);

  // Create idx2hash for lightbox navigation (unique photos only)
  const idx2hash = useMemo(() => {
    const uniquePhotos = new Map<string, { id: string }>();
    points.forEach((point) => {
      if (point.photo && !uniquePhotos.has(point.photo)) {
        uniquePhotos.set(point.photo, { id: point.photo });
      }
    });
    return Array.from(uniquePhotos.values());
  }, [points]);

  // Sort person stats for legend
  const sortedPersonStats = useMemo(() => {
    const entries = Array.from(personStats.entries());
    return entries
      .filter(([name]) => name !== "unknown")
      .sort((a, b) => b[1].count - a[1].count);
  }, [personStats]);

  const unknownCount = personStats.get("unknown")?.count || 0;
  const hasData = points.length > 0;

  if (clustering) {
    return (
      <Stack align="center" justify="center" h={height}>
        <Loader size="lg" />
        <Text c="dimmed">{t("faceclusterloading")}</Text>
      </Stack>
    );
  }

  if (clustered && hasData) {
    return (
      <RemoveScroll enabled={lightboxOpen}>
        <Stack ref={observeChange} gap="md">
          <div>
            <Title order={3}>{t("facecluster")}</Title>
            <Text c="dimmed" size="sm">
              {t("faceclusterexplanation")}
            </Text>
          </div>

          {/* Legend */}
          <ScrollArea type="hover" offsetScrollbars>
            <Group gap="xs" wrap="nowrap">
              <Badge
                variant={selectedPerson === null ? "filled" : "light"}
                color="gray"
                size="lg"
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
                      <Text size="sm">
                        {name} - {stat.count} {t("faces")}
                      </Text>
                    </Group>
                  }
                  withArrow
                >
                  <Badge
                    variant={selectedPerson === name ? "filled" : "light"}
                    style={{
                      cursor: "pointer",
                      backgroundColor:
                        selectedPerson === name ? stat.color : `${stat.color}20`,
                      color: selectedPerson === name ? "white" : stat.color,
                      borderColor: stat.color,
                    }}
                    size="lg"
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
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    setSelectedPerson(selectedPerson === "unknown" ? null : "unknown")
                  }
                  leftSection={<IconUserQuestion size={14} />}
                >
                  {t("unknown")} ({unknownCount})
                </Badge>
              )}
            </Group>
          </ScrollArea>

          {/* Canvas */}
          <Box
            ref={containerRef}
            style={{
              position: "relative",
              borderRadius: "var(--mantine-radius-md)",
              overflow: "hidden",
              background: isDark
                ? "linear-gradient(135deg, rgba(30, 30, 40, 0.8) 0%, rgba(20, 20, 30, 0.9) 100%)"
                : "linear-gradient(135deg, rgba(250, 250, 255, 0.9) 0%, rgba(240, 245, 255, 0.95) 100%)",
              border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)"}`,
              boxShadow: isDark
                ? "inset 0 1px 1px rgba(255, 255, 255, 0.05)"
                : "inset 0 1px 1px rgba(255, 255, 255, 0.8)",
            }}
          >
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
                  background: isDark ? "rgba(30, 30, 40, 0.95)" : "rgba(255, 255, 255, 0.95)",
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
                      {hoveredPoint.name === "unknown" ? t("unknown") : hoveredPoint.name}
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
      <div>
        <Title order={3}>{t("facecluster")}</Title>
        <Text c="dimmed">{t("faceclusterexplanation")}</Text>
      </div>
      <EmptyState
        icon={<IconMoodSmile size={40} />}
        title={t("emptystate.faces.title")}
        description={t("emptystate.faces.description")}
        actionLabel={t("emptystate.goToLibrary")}
        actionLink="/library"
      />
    </Stack>
  );
}

export default FaceClusterGraph;
