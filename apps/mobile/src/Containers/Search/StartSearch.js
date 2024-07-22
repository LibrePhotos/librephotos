import React from 'react'
import { View } from 'react-native'
import { Icon, Text } from 'native-base'
import FeatherIcon from 'react-native-vector-icons/Feather'
import { useTheme } from '@/Theme'

const StartSearch = ({ height, width, mode }) => {
  const { Common, Colors, Layout, Gutters } = useTheme()

  return (
    <View style={[Layout.fullSize, Layout.center, Common.backgroundDefault]}>
      <Icon size="3xl" as={<FeatherIcon name="search" />} color={Colors.text} />
      <Text
        color={Colors.textMuted}
        textAlign={'center'}
        italic
        style={[Gutters.smallTMargin]}
      >
        Try searching for
        {'\n'}'Sunset in Mountains'
      </Text>
    </View>
  )
}

export default StartSearch
