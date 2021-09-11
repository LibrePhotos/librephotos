import React from 'react'
import { View } from 'react-native'
import { Icon, Text } from 'native-base'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTheme } from '@/Theme'

const UnderConstructionContainer = () => {
  const { Colors, Layout, Gutters } = useTheme()

  return (
    <View style={[Layout.fill, Layout.colCenter]}>
      <Icon
        size="3xl"
        as={<MaterialCommunityIcons name="hammer-wrench" />}
        color={Colors.text}
      />
      <Text style={[Gutters.smallTMargin]} color={Colors.text}>
        {' '}
        Under Construction{' '}
      </Text>
    </View>
  )
}

export default UnderConstructionContainer
