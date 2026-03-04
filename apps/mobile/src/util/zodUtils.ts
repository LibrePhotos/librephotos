import { ZodError, ZodSchema } from 'zod'
import { notification } from '../service/notifications'

/**
 * Parse data with a Zod schema and automatically show error notifications on failure.
 *
 * @param schema - The Zod schema to parse against
 * @param data - The data to parse
 * @param errorTitle - Optional title for the error notification (default: "Parse Error")
 * @returns The parsed data
 * @throws ZodError if parsing fails
 */
export function parseWithNotification<T>(
  schema: ZodSchema<T>,
  data: unknown,
  errorTitle: string = 'Parse Error',
): T {
  try {
    return schema.parse(data)
  } catch (error) {
    if (error instanceof ZodError) {
      // Format Zod validation errors into a readable message
      const errorMessages = error.issues.map(issue => {
        const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : ''
        return `${issue.message}${path}`
      })

      const errorMessage =
        errorMessages.length > 0
          ? errorMessages.join('; ')
          : error.message || 'Failed to parse response'

      notification.requestFailed(
        errorTitle,
        `${errorMessage}. Please report this issue on GitHub.`,
      )
    } else {
      // Handle non-Zod errors
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      notification.requestFailed(
        errorTitle,
        `${errorMessage}. Please report this issue on GitHub.`,
      )
    }

    throw error
  }
}
