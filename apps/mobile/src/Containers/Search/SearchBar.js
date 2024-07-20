import React, { useState } from 'react'
import { useColorScheme } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import {
  Button,
  Input,
  HStack,
  IconButton,
  Icon,
  StatusBar,
  Center,
} from 'native-base'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { useTheme } from '@/Theme'
import FindPhotos from '../../Store/Search/FindPhotos'
import UpdateQuery from '../../Store/Search/UpdateQuery'

const SearchBar = ({ showMenu = false }) => {
  const { Colors, Gutters } = useTheme()
  const dispatch = useDispatch()

  const colorScheme = useColorScheme()

  const isDark = useSelector(state => state.theme.darkMode)
  const darkMode = isDark === null ? colorScheme === 'dark' : isDark
  const statusBarStyle = darkMode ? 'light-content' : 'dark-content'

  const [searchQuery, setSearchQuery] = useState('')

  const handleSearch = ({ nativeEvent: { text } }) => {
    dispatch(FindPhotos.action({ searchQuery: text }))
  }

  const handleBack = () => {
    setSearchQuery('')
    dispatch(UpdateQuery.action({ searchQuery: '' }))
    // navigation.goBack()
  }

  return (
    <>
      <StatusBar
        backgroundColor={Colors.screenBackground}
        barStyle={statusBarStyle}
      />

      {/* <Box safeAreaTop backgroundColor="#6200ee" /> */}

      <HStack
        bg={Colors.screenBackground}
        px={2}
        py={5}
        justifyContent="space-between"
        alignItems="center"
      >
        <HStack size={1}>
          {searchQuery.length > 0 && (
            <IconButton
              mr={2}
              icon={
                <Icon
                  size="sm"
                  as={<Ionicons name="arrow-back" />}
                  color={Colors.text}
                />
              }
              onPress={handleBack}
            />
          )}
        </HStack>
        <Center flexGrow={1}>
          <Input
            _focus={{
              borderColor: 'grey',
            }}
            returnKeyType="search"
            autoFocus={true}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            value={searchQuery}
            clearButtonMode="while-editing"
            style={[Gutters.smallHMargin]}
            placeholder="Search"
            variant="filled"
            borderRadius={10}
            py={2}
            px={2}
            InputLeftElement={
              <Icon size="md" ml={2} as={<Ionicons name="search" />} />
            }
          />
        </Center>
        {showMenu && (
          <HStack mx={2} size={1}>
            <Button variant="outline" size="sm" title="Go">
              Go
            </Button>
          </HStack>
        )}
      </HStack>
    </>
  )
}

export default SearchBar
