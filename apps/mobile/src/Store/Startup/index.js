import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import InitStartup from './Init'

export default buildSlice('startup', [InitStartup]).reducer
