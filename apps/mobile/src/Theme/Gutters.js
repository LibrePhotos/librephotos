import { StyleSheet } from 'react-native'

/**
 * Generate Styles depending on MetricsSizes vars availabled at ./Theme/Variables
 * Styles are like :
 * <size><direction><op>: {
 *    <op><direction>: <value>
 * }
 * where:
 * <size>: is the key of the variable included in MetricsSizes
 * <direction>: can be ['Bottom','Top','Right','Left','Horizontal','Vertical']
 * <op>: can be ['Margin', 'Padding']
 * <value>: is the value of the <size>
 */

/**
 *
 * @param Theme can be spread like {Colors, NavigationColors, Gutters, Layout, Common, ...args}
 * @return {*}
 */
export default function ({ MetricsSizes }) {
  return StyleSheet.create({
    ...Object.entries(MetricsSizes).reduce(
      (acc, [key, value]) => ({
        ...acc,
        /* Margins */
        [`${key}BMargin`]: {
          marginBottom: value,
        },
        [`${key}TMargin`]: {
          marginTop: value,
        },
        [`${key}RMargin`]: {
          marginRight: value,
        },
        [`${key}LMargin`]: {
          marginLeft: value,
        },
        [`${key}VMargin`]: {
          marginVertical: value,
        },
        [`${key}HMargin`]: {
          marginHorizontal: value,
        },
        /* Paddings */
        [`${key}BPadding`]: {
          paddingBottom: value,
        },
        [`${key}TPadding`]: {
          paddingTop: value,
        },
        [`${key}RPadding`]: {
          paddingRight: value,
        },
        [`${key}LPadding`]: {
          paddingLeft: value,
        },
        [`${key}VPadding`]: {
          paddingVertical: value,
        },
        [`${key}HPadding`]: {
          paddingHorizontal: value,
        },
      }),
      {},
    ),
  })
}
