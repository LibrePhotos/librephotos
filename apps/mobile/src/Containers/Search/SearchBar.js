import React, { useState } from 'react'
import { useColorScheme } from 'react-native'
import { useThemeStore } from '@/stores/themeStore'
import {
  Button,
  Input,
  HStack,
  IconButton,
  Icon,
  StatusBar,
  Center,
} from 'native-base'
import Feather from 'react-native-vector-icons/Feather'
import { useTheme } from '@/Theme'

const SearchBar = ({
  showMenu = false,
  searchTerm = '',
  onSearch,
  onClear,
}) => {
  const { Colors, Gutters } = useTheme()

  const colorScheme = useColorScheme()

  const isDark = useThemeStore(s => s.darkMode)
  const darkMode = isDark === null ? colorScheme === 'dark' : isDark
  const statusBarStyle = darkMode ? 'light-content' : 'dark-content'

  const [localQuery, setLocalQuery] = useState(searchTerm)

  const handleSearch = ({ nativeEvent: { text } }) => {
    if (onSearch) {
      onSearch(text)
    }
  }

  const handleBack = () => {
    setLocalQuery('')
    if (onClear) {
      onClear()
    }
  }

  return (
    <>
      <StatusBar
        backgroundColor={Colors.screenBackground}
        barStyle={statusBarStyle}
      />

      <HStack
        bg={Colors.screenBackground}
        px={2}
        py={5}
        justifyContent="space-between"
        alignItems="center"
      >
        <HStack size={1}>
          {localQuery.length > 0 && (
            <IconButton
              mr={2}
              icon={
                <Icon
                  size="sm"
                  as={<Feather name="arrow-back" />}
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
            onChangeText={setLocalQuery}
            onSubmitEditing={handleSearch}
            value={localQuery}
            clearButtonMode="while-editing"
            style={[Gutters.smallHMargin]}
            placeholder="Search"
            variant="filled"
            borderRadius={10}
            py={2}
            px={2}
            InputLeftElement={
              <Icon size="md" ml={2} as={<Feather name="search" />} />
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
