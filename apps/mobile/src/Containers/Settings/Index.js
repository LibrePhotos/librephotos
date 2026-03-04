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
import { useThemeStore } from '@/stores/themeStore'
import { useConfigStore } from '@/stores/configStore'
import { useAuthStore } from '@/stores/authStore'
import { useLocalImagesStore } from '@/stores/localImagesStore'
import { useUploadStore } from '@/stores/uploadStore'
import { syncAllLocalImages, removeBackedUpImages } from '@/stores/localImagesActions'
import { SyncStatus } from '@/stores/types/localImages.zod'
import { TopBar } from '@/Components'
import { SettingSubHeader } from './SettingSubHeader'
import { OptionMultiSelect } from './OptionMultiSelect'
import { OptionButton } from './OptionButton'
import { useLogoutMutation } from '@/api_client/auth'
import { version } from '../../../package.json'
import { OptionToggle } from './OptionToggle'

const SettingsContainer = () => {
  const { Colors, Layout, Gutters } = useTheme()
  const toast = useToast()
  const { mutate: logoutMutate } = useLogoutMutation()
  const baseurl = useConfigStore(s => s.baseurl)
  const logging = useConfigStore(s => s.logging)
  const configureLogging = useConfigStore(s => s.configureLogging)
  const theme = useThemeStore(s => s.darkMode)
  const changeTheme = useThemeStore(s => s.changeTheme)
  const user = useAuthStore(s => s.access)
  const localImages = useLocalImagesStore(s => s.images)
  const resetLocalImages = useLocalImagesStore(s => s.reset)
  const { current, total, isUploading } = useUploadStore()

  const mapTheme = darkMode => {
    if (darkMode == null) {
      return 'System Default'
    } else if (darkMode === false) {
      return 'Light'
    } else {
      return 'Dark'
    }
  }

  const onChangeTheme = themeName => {
    switch (themeName) {
      case 'System Default':
        changeTheme({ darkMode: null })
        break
      case 'Light':
        changeTheme({ darkMode: false })
        break
      case 'Dark':
        changeTheme({ darkMode: true })
        break
    }
  }

  const toggleLogging = () => {
    if (logging) {
      configureLogging({ logging: false })
      toast.show({ title: 'Logging Disabled.', duration: 1500 })
    } else {
      configureLogging({ logging: true })
      toast.show({ title: 'Logging Enabled.', duration: 1500 })
    }
  }

  const logoutClick = () => {
    logoutMutate()
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
            <OptionButton title="Account" subTitle={user?.name} icon="user" />
            <OptionButton title="Server" subTitle={baseurl} />
            <OptionMultiSelect
              title="Dark Mode"
              subTitle={mapTheme(theme)}
              options={['System Default', 'Light', 'Dark']}
              onSelect={option => onChangeTheme(option)}
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
                onPress={() => syncAllLocalImages()}
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
              onPress={() => removeBackedUpImages()}
            />
            <OptionButton
              title="Reset Local Images"
              subTitle="Reset Local Images, if an error occured"
              onPress={() => {
                resetLocalImages()
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
                toggleLogging()
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
