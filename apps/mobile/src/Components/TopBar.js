import React from 'react'
import { HStack, IconButton, Icon, Text, StatusBar } from 'native-base'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTheme } from '@/Theme'

const TopBar = ({ height, width, mode }) => {
  const { Layout, Images } = useTheme()

  return (
    <>
      <StatusBar backgroundColor="#000000" barStyle="light-content" />

      {/* <Box safeAreaTop backgroundColor="#6200ee" /> */}

      <HStack
        bg="#ffffff"
        px={1}
        py={3}
        justifyContent="space-between"
        alignItems="center"
      >
        <HStack space={1} alignItems="center">
          <IconButton
            icon={
              <Icon
                size="sm"
                as={<MaterialCommunityIcons name="chevron-left" />}
                color="black"
              />
            }
          />
        </HStack>
        <HStack space={4} alignItems="center">
          <Text color="black" fontSize={20} fontWeight="bold">
            LibrePhotos
          </Text>
        </HStack>
        <HStack space={2}>
          <IconButton
            icon={
              <Icon
                as={<MaterialCommunityIcons name="dots-vertical" />}
                size="sm"
                color="black"
              />
            }
          />
        </HStack>
      </HStack>
    </>
  )
}

export default TopBar
