import React from 'react'
import { View } from 'react-native'
import { Icon, Text } from 'native-base'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTheme } from '@/Theme'

const NoResultsError = ({ height, width, mode }) => {
  const { Layout, Gutters } = useTheme()

  return (
    <View style={[Layout.fullSize, Layout.center]}>
      <Icon
        size="3xl"
        as={<MaterialCommunityIcons name="alert" />}
        color="black"
      />
      <Text style={[Gutters.smallTMargin]}> No Images Found </Text>
    </View>
  )
}

export default NoResultsError
