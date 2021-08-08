import React from 'react'
import { View } from 'react-native'
import { Icon, Text } from 'native-base'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTheme } from '@/Theme'

const UnderConstructionContainer = () => {
  const { Colors, Layout, Gutters, Fonts } = useTheme()

  return (
    <View style={[Layout.fill, Layout.colCenter]}>
      <Icon
        size="3xl"
        as={<MaterialCommunityIcons name="alert" />}
        color="black"
      />
      <Text style={[Gutters.smallTMargin]}> Under Construction </Text>
    </View>
  )
}

export default UnderConstructionContainer
