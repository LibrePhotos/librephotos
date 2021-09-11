import React from 'react'
import { View, Text } from 'native-base'
import { useTheme } from '@/Theme'

export const SettingSubHeader = ({ subHeading }) => {
  const { Colors, Layout, Gutters } = useTheme()

  return (
    <View
      style={[
        Layout.fullWidth,
        Gutters.regularLPadding,
        Gutters.regularTPadding,
        Gutters.smallBPadding,
      ]}
    >
      <Text fontWeight="bold" color={Colors.secondary}>
        {subHeading}
      </Text>
    </View>
  )
}
