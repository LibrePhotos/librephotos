/**
 * Regression test for the inverted "Debug Logging" toggle.
 *
 * configureLogging() branched on `logging === false` but ran the *enabled*
 * message in that branch, so the two outcomes were swapped:
 *
 *   toggle ON  -> FileLogger.debug('Logging: Disabled') + deleteLogFiles()
 *   toggle OFF -> FileLogger.debug('Logging: Enabled')
 *
 * Deleting the log files at the exact moment the user turns logging ON
 * destroys the diagnostic data they just asked the app to collect (the
 * shake-to-email bug report in Navigators/Application.js ships those files).
 *
 * `logging: true` means "logging is on" everywhere else in the app:
 *   Containers/Settings/Index.js -> configureLogging({ logging: true })
 *                                   toasts "Logging Enabled."
 *   Navigators/Application.js    -> `if (logging) FileLogger.enableConsoleCapture()`
 *
 * so the delete belongs to the OFF branch: turning the switch off clears the
 * locally stored logs, turning it on leaves them alone.
 */

const mockDebug = jest.fn()
const mockDeleteLogFiles = jest.fn()

jest.mock('react-native-file-logger', () => ({
  FileLogger: {
    debug: (...args: unknown[]) => mockDebug(...args),
    deleteLogFiles: (...args: unknown[]) => mockDeleteLogFiles(...args),
  },
}))

import { useConfigStore } from '../configStore'

describe('configureLogging', () => {
  beforeEach(() => {
    mockDebug.mockClear()
    mockDeleteLogFiles.mockClear()
    useConfigStore.setState({ logging: true })
  })

  it('keeps the existing log files when logging is switched on', () => {
    useConfigStore.setState({ logging: false })

    useConfigStore.getState().configureLogging({ logging: true })

    expect(useConfigStore.getState().logging).toBe(true)
    expect(mockDebug).toHaveBeenCalledWith('Logging: Enabled')
    // The whole point of the bug: never wipe the logs the user just enabled.
    expect(mockDeleteLogFiles).not.toHaveBeenCalled()
  })

  it('clears the stored log files when logging is switched off', () => {
    useConfigStore.getState().configureLogging({ logging: false })

    expect(useConfigStore.getState().logging).toBe(false)
    expect(mockDebug).toHaveBeenCalledWith('Logging: Disabled')
    expect(mockDeleteLogFiles).toHaveBeenCalledTimes(1)
  })
})
