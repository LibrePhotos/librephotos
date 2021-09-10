import React from 'react'
import { useColorScheme } from 'react-native'
import { useSelector } from 'react-redux'
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

  // Get the scheme device
  const colorScheme = useColorScheme()

  const isDark = useSelector(state => state.theme.darkMode)
  const darkMode = isDark === null ? colorScheme === 'dark' : isDark
  const statusBarStyle = darkMode ? 'light-content' : 'dark-content'
  console.log(statusBarStyle, Colors.screenBackground)

  return (
    <>
      <StatusBar
        backgroundColor={Colors.screenBackground}
        barStyle={statusBarStyle}
      />

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
                  color={Colors.text}
                />
              }
              onPress={() => navigation.goBack()}
            />
          ) : (
            <IconButton
              icon={<Icon size="sm" as={<Text> </Text>} color={Colors.text} />}
            />
          )}
        </HStack>
        <HStack space={4} alignItems="center">
          <Text color={Colors.text} fontSize={20} fontWeight="bold">
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
                  color={Colors.text}
                />
              }
            />
          ) : (
            <IconButton
              icon={<Icon size="sm" as={<Text> </Text>} color={Colors.text} />}
            />
          )}
        </HStack>
      </HStack>
    </>
  )
}

export default TopBar
