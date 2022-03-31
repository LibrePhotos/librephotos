import { z } from "zod";

export const PersonSchema = z.object({
  name: z.string(),
  face_url: z.string().nullable(),
  face_count: z.number(),
  face_photo_url: z.string().nullable(),
  video: z.boolean().optional(),
  id: z.number(),
  newPersonName: z.string().optional(),
  cover_photo: z.string().optional(),
});

export const PersonInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type PersonInfo = z.infer<typeof PersonInfoSchema>;
export const PersonList = z.array(PersonSchema);

export const Node = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
});

export const Link = z.object({
  source: z.string(),
  target: z.string(),
});

export const PersonDataPointList = z.object({
  nodes: Node.array(),
  links: Link.array(),
});
