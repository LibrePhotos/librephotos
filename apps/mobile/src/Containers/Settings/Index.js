import React from 'react'
import { View } from 'react-native'
import { Divider, useToast, ScrollView, VStack } from 'native-base'
import { useTheme } from '@/Theme'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigation } from '@react-navigation/core'
import { TopBar } from '@/Components'
import ChangeTheme from '@/Store/Theme/ChangeTheme'
import { SettingSubHeader } from './SettingSubHeader'
import { SettingItem } from './SettingItem'
import { OptionMultiSelect } from './OptionMultiSelect'
import { OptionButton } from './OptionButton'
import LogoutUser from '@/Store/Auth/LogoutUser'
import { version } from '../../../app.json'
import UpdateToken from '../../Services/Auth/UpdateToken'

const SettingsContainer = () => {
  const { Colors, Layout, Gutters, Fonts } = useTheme()
  const dispatch = useDispatch()
  const toast = useToast()
  const navigation = useNavigation()
  const baseurl = useSelector(state => state.config.baseurl)
  const theme = useSelector(state => state.theme.darkMode)

  const mapTheme = darkMode => {
    if (darkMode == null) return 'System Default'
    else if (darkMode === false) return 'Light'
    else return 'Dark'
  }

  const changeTheme = theme => {
    switch (theme) {
      case 'System Default':
        dispatch(ChangeTheme.action({ darkMode: null }))
        break
      case 'Light':
        dispatch(ChangeTheme.action({ darkMode: false }))
        break
      case 'Dark':
        dispatch(ChangeTheme.action({ darkMode: true }))
        break
    }
  }

  const refreshToken = () => {
    UpdateToken().then(() => {
      toast.show({ title: 'Token Updated', duration: 1500 })
    })
  }

  const logout = () => {
    dispatch(LogoutUser.action())
    navigation.navigate('Login')
  }

  return (
    <>
      <TopBar />
      <ScrollView
        style={[
          Gutters.tinyTPadding,
          { backgroundColor: Colors.screenBackground },
        ]}
      >
        <View style={[Layout.fill]}>
          <SettingSubHeader subHeading={'App'} />
          <VStack divider={<Divider bg={Colors.textMuted} />}>
            <OptionButton title="Account" subTitle="Admin" icon="person" />
            <OptionButton title="Server" subTitle={baseurl} />
            <OptionMultiSelect
              title="Dark Mode"
              subTitle={mapTheme(theme)}
              options={['System Default', 'Light', 'Dark']}
              onSelect={option => changeTheme(option)}
            />
            <OptionButton
              title="Logout"
              subTitle="Logout and clear all data."
              onPress={() => logout()}
            />
          </VStack>

          <SettingSubHeader subHeading={'LibrePhotos Server'} />
          <VStack divider={<Divider bg={Colors.textMuted} />}>
            <OptionButton title="Server" subTitle={baseurl} />
          </VStack>

          <SettingSubHeader subHeading={'Debug Options'} />
          <VStack divider={<Divider bg={Colors.textMuted} />}>
            <OptionButton
              title="Refresh Token"
              subTitle="Regenerate the Auth JWT Token. Use if you face error loading Images/Screens."
              onPress={() => {
                refreshToken()
              }}
            />
            <OptionButton
              title="About"
              subTitle={'Version: ' + version}
              onPress={() => {}}
            />
          </VStack>
        </View>
      </ScrollView>
    </>
  )
}

export default SettingsContainer
