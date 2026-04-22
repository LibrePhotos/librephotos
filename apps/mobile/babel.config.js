const presets = ['module:metro-react-native-babel-preset']
const plugins = [
  ['@babel/plugin-transform-private-methods', { loose: true }],
  ['@babel/plugin-transform-private-property-in-object', { loose: true }],
  ['@babel/plugin-transform-class-properties', { loose: true }],
  'react-native-reanimated/plugin',
]

plugins.push([
  'module-resolver',
  {
    root: ['./src'],
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    alias: {
      '@': './src',
    },
  },
])

module.exports = {
  presets,
  plugins,
}
