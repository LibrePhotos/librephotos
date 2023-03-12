import React from 'react'
import { View } from 'react-native'
import {
  Divider,
  useToast,
  ScrollView,
  VStack,
  Text,
  Box,
  Flex,
  Spinner,
} from 'native-base'
import { useTheme } from '@/Theme'
import { useSelector } from 'react-redux'
import { useNavigation } from '@react-navigation/core'
import { TopBar } from '@/Components'
import ChangeTheme from '@/Store/Theme/ChangeTheme'
import { SettingSubHeader } from './SettingSubHeader'
import { OptionMultiSelect } from './OptionMultiSelect'
import { OptionButton } from './OptionButton'
import { logout } from '@/Store/Auth/authSlice'
import { version } from '../../../package.json'
import { OptionToggle } from './OptionToggle'
import { configActions } from '@/Store/Config/configSlice'
import { useAppDispatch } from '@/Store/store'
import {
  reset,
  removeBackedUpImages,
  syncAllLocalImages,
} from '@/Store/LocalImages/LocalImagesSlice'
import { SyncStatus } from '@/Store/LocalImages/LocalImages.zod'

const SettingsContainer = () => {
  const { Colors, Layout, Gutters } = useTheme()
  const dispatch = useAppDispatch()
  const toast = useToast()
  const navigation = useNavigation()
  const baseurl = useSelector(state => state.config.baseurl)
  const logging = useSelector(state => state.config.logging)
  const theme = useSelector(state => state.theme.darkMode)
  const user = useSelector(state => state.auth?.access)
  const localImages = useSelector(state => state.localImages.images)
  const { current, total, isUploading } = useSelector(state => state.upload)

  const mapTheme = darkMode => {
    if (darkMode == null) {
      return 'System Default'
    } else if (darkMode === false) {
      return 'Light'
    } else {
      return 'Dark'
    }
  }

  const changeTheme = themeName => {
    switch (themeName) {
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

  const configureLogging = () => {
    if (logging) {
      configActions.configureLogging({ logging: false })
      toast.show({ title: 'Logging Disabled.', duration: 1500 })
    } else {
      configActions.configureLogging({ logging: true })
      toast.show({ title: 'Logging Enabled.', duration: 1500 })
    }
  }

  const logoutClick = () => {
    dispatch(logout())
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
            <OptionButton title="Account" subTitle={user?.name} icon="person" />
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
              onPress={() => logoutClick()}
            />
          </VStack>

          <SettingSubHeader subHeading={'Syncing'} />
          <VStack divider={<Divider bg={Colors.textMuted} />}>
            {isUploading && (
              <Box alignItems="center">
                <Spinner />{' '}
                <Text>
                  {total > 1
                    ? `Uploading ${Math.round((current / total) * 100)}%`
                    : 'Uploading 0%'}
                </Text>
              </Box>
            )}
            {!isUploading && (
              <OptionButton
                title="Sync all images"
                subTitle="Upload all local images to the server"
                onPress={() => dispatch(syncAllLocalImages())}
              />
            )}
          </VStack>
          <Box alignItems="center">
            <Flex direction="row" h="58" p="4">
              <Box alignItems="center">
                <Text color={Colors.text}>Local</Text>
                <Text color={Colors.text}>
                  {
                    localImages.filter(i => i.syncStatus === SyncStatus.LOCAL)
                      .length
                  }
                </Text>
              </Box>
              <Divider thickness="2" mx="2" orientation="vertical" />
              <Box alignItems="center">
                <Text color={Colors.text}>Syncing</Text>
                <Text color={Colors.text}>
                  {
                    localImages.filter(i => i.syncStatus === SyncStatus.SYNCING)
                      .length
                  }
                </Text>
              </Box>
              <Divider thickness="2" mx="2" orientation="vertical" />

              <Box alignItems="center">
                <Text color={Colors.text}>Synced</Text>
                <Text color={Colors.text}>
                  {
                    localImages.filter(i => i.syncStatus === SyncStatus.SYNCED)
                      .length
                  }
                </Text>
              </Box>
            </Flex>
          </Box>
          <VStack divider={<Divider bg={Colors.textMuted} />}>
            <OptionButton
              title="Remove backed up images"
              subTitle="Remove backed up images from local storage"
              onPress={() => dispatch(removeBackedUpImages())}
            />
            <OptionButton
              title="Reset Local Images"
              subTitle="Reset Local Images, if an error occured"
              onPress={() => {
                dispatch(reset())
              }}
            />
          </VStack>

          <SettingSubHeader subHeading={'LibrePhotos Server'} />
          <VStack divider={<Divider bg={Colors.textMuted} />}>
            <OptionButton title="Server" subTitle={baseurl} />
          </VStack>

          <SettingSubHeader subHeading={'Debug Options'} />
          <VStack divider={<Divider bg={Colors.textMuted} />}>
            <OptionToggle
              title="Debug Logging"
              subTitle="Logging to local storage. No data is ever uploaded to the server without your consent."
              value={logging}
              onPress={() => {
                configureLogging()
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
