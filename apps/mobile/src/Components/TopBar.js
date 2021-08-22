import React from 'react'
import { View, HStack, IconButton, Icon, Text, StatusBar } from 'native-base'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTheme } from '@/Theme'
import { useNavigation } from '@react-navigation/native'

const TopBar = ({
  title = 'LibrePhotos',
  showBack = false,
  showMenu = false,
}) => {
  const { Colors, Layout, Images } = useTheme()
  const navigation = useNavigation()

  return (
    <>
      <StatusBar backgroundColor={Colors.transparent} barStyle="dark-content" />

      {/* <Box safeAreaTop backgroundColor="#6200ee" /> */}

      <HStack
        bg={Colors.screenBackground}
        px={1}
        py={3}
        justifyContent="space-between"
        alignItems="center"
      >
        <HStack space={1} alignItems="center">
          {showBack ? (
            <IconButton
              icon={
                <Icon
                  size="sm"
                  as={<MaterialCommunityIcons name="chevron-left" />}
                  color="black"
                />
              }
              onPress={() => navigation.goBack()}
            />
          ) : (
            <IconButton
              icon={<Icon size="sm" as={<Text> </Text>} color="black" />}
            />
          )}
        </HStack>
        <HStack space={4} alignItems="center">
          <Text color="black" fontSize={20} fontWeight="bold">
            {title}
          </Text>
        </HStack>
        <HStack space={2}>
          {showMenu ? (
            <IconButton
              icon={
                <Icon
                  as={<MaterialCommunityIcons name="dots-vertical" />}
                  size="sm"
                  color="black"
                />
              }
            />
          ) : (
            <IconButton
              icon={<Icon size="sm" as={<Text> </Text>} color="black" />}
            />
          )}
        </HStack>
      </HStack>
    </>
  )
}

export default TopBar
