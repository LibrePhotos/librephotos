import { z } from 'zod'

export const ConfigStateSchema = z.object({
  baseurl: z.string(),
  logging: z.boolean(),
})

export type IConfigState = z.infer<typeof ConfigStateSchema>
