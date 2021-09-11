import React from 'react'
import { View, Text, HStack, VStack } from 'native-base'
import { useTheme } from '@/Theme'
import Ionicons from 'react-native-vector-icons/Ionicons'

export const SettingItem = ({ title, subTitle, icon = null }) => {
  const { Colors, Layout, Gutters, Fonts } = useTheme()

  return (
    <View
      style={[Layout.fullWidth, Gutters.regularLPadding, Gutters.smallVPadding]}
    >
      <HStack space={3}>
        {icon && (
          <View flex={0.15} style={[Gutters.LargeHMargin, Layout.center]}>
            <Ionicons name={icon} size={35} color={Colors.text} />
          </View>
        )}

        <VStack style={[Gutters.LargeHMargin]}>
          <Text fontSize="lg" color={Colors.text}>
            {title}
          </Text>
          <Text fontSize="sm" color={Colors.textMuted}>
            {subTitle}
          </Text>
        </VStack>
      </HStack>
    </View>
  )
}
