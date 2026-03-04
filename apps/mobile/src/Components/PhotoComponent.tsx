import React from 'react'
import { Pressable, View, Image, Text, StyleSheet } from 'react-native'
import { getConfig } from '../Config'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTheme } from '@/Theme'
import { useConfigStore } from '@/stores/configStore'
import { useAuthToken } from '@/stores/authStore'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

type Input = {
  item: any
  index: number
  section: any
}

type Props = {
  input: Input
  handleImagePress: (item: any, index: number, section: any) => void
}

export const PhotoComponent = (props: Props) => {
  const { input, handleImagePress } = props
  const { item, index, section } = input

  const { Common, Layout } = useTheme()
  const baseurl = useConfigStore(s => s.baseurl)
  const authToken = useAuthToken()

  return (
    <Pressable
      style={[Common.timeline.photoItem]}
      onPress={() => handleImagePress(item, index, section)}
    >
      {!item.isTemp && (
        <View>
          <Icon
            name={
              item.syncStatus === 'local'
                ? 'cloud-upload-outline'
                : item.syncStatus === 'synced'
                ? 'cloud-check-outline'
                : 'cloud-outline'
            }
            size={20}
            color={'rgba(0,0,0,0.5)'}
            style={{
              position: 'absolute',
              bottom: 0,
              right: 20,
              zIndex: 1,
            }}
          />
          {
            // To-Do: this is weird but it works
          }
          <Image
            style={{ width: '300%', height: '100%' }}
            source={
              item.syncStatus
                ? { uri: item.url }
                : {
                    uri:
                      getConfig(baseurl).MEDIA_URL +
                      (item.type === 'video'
                        ? '/thumbnails_big/'
                        : '/square_thumbnails/') +
                      (item.url || item.image_hash),
                    method: 'GET',
                    headers: {
                      Authorization: 'Bearer ' + authToken,
                    },
                  }
            }
          />
          {item.type === 'video' && (
            <View style={videoOverlayStyles.container}>
              <Icon name="play" size={16} color="white" />
              {item.video_length &&
                item.video_length !== '' &&
                item.video_length !== 'None' && (
                  <Text style={videoOverlayStyles.duration}>
                    {formatDuration(parseFloat(item.video_length))}
                  </Text>
                )}
            </View>
          )}
        </View>
      )}
      {item.isTemp && <View style={Layout.fullSize} />}
    </Pressable>
  )
}

const videoOverlayStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  duration: {
    color: 'white',
    fontSize: 11,
    marginLeft: 2,
    fontVariant: ['tabular-nums'],
  },
})
