import React from 'react'
import { View, Text, HStack, VStack, Switch } from 'native-base'
import { useTheme } from '@/Theme'
import Feather from 'react-native-vector-icons/Feather'

export const SettingItem = ({
  title,
  subTitle,
  toggleValue = null,
  onToggle = () => {},
  icon = null,
}) => {
  const { Colors, Layout, Gutters } = useTheme()

  return (
    <View
      style={[Layout.fullWidth, Gutters.regularHPadding, Gutters.smallVPadding]}
    >
      <HStack space={3}>
        {icon && (
          <View flex={0.15} style={[Gutters.tinyHMargin, Layout.center]}>
            <Feather name={icon} size={35} color={Colors.text} />
          </View>
        )}

        <VStack flex={1} style={[Gutters.tinyHMargin, Layout.selfStretch]}>
          <Text fontSize="lg" color={Colors.text}>
            {title}
          </Text>
          <Text fontSize="sm" color={Colors.textMuted}>
            {subTitle}
          </Text>
        </VStack>

        {toggleValue !== null && (
          <View flex={0.1} style={[Gutters.tinyHMargin, Layout.center]}>
            <Switch isChecked={toggleValue} onToggle={onToggle} />
          </View>
        )}
      </HStack>
    </View>
  )
}
