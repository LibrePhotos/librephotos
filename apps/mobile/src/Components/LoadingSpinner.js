import React from 'react'
import { View } from 'react-native'
import { Spinner, Text } from 'native-base'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTheme } from '@/Theme'

const LoadingSpinner = ({ height, width, mode }) => {
  const { Colors, Layout, Gutters } = useTheme()

  return (
    <View style={[Layout.fullSize, Layout.center]}>
      <Spinner
        color={Colors.primary}
        size="lg"
        accessibilityLabel="Loading posts"
      />
      <Text style={[Gutters.smallTMargin]}> Loading... </Text>
    </View>
  )
}

export default LoadingSpinner
