import React, { useState, useEffect } from 'react'
import { View } from 'react-native'
import { useDispatch } from 'react-redux'
import { Text } from 'native-base'
import moment from 'moment'
import { useTheme } from '@/Theme'
import { NoResultsError } from '.'
import { PhotoComponent } from './PhotoComponent'
import { LightBox } from './LightBox'
import FetchAlbumDate from '../Store/Album/FetchAlbumDate'
import { FlashList } from '@shopify/flash-list'

/**
 * Represents a group with an ID and a page number.
 */
type Group = {
  id: string
  page: number
}

/**
 * Renders a timeline list component with the provided data.
 * @param data An array of groups with a title, an array of data items, and an ID.
 * @param onRefresh A function to be called when the list is refreshed.
 * @param refreshing A boolean indicating whether the list is currently being refreshed.
 * @returns A React component that renders a timeline list.
 */
const TimelineList = ({ data, onRefresh = () => {}, refreshing = false }) => {
  const { Colors, Gutters } = useTheme()
  const dispatch = useDispatch()

  const [groups, setGroups] = useState([] as Group[])
  const [lightBoxVisible, setLightBoxVisible] = useState(false)
  const [currImage, setCurrImage] = useState({ item: {} })

  /**
   * Adds a group ID to all data items in each group of data.
   * @param group An object representing a group of data items.
   * @returns An object representing the group with its data items' IDs updated.
   */
  const dataWithIds = data.map(group => {
    return {
      ...group,
      data: group.data.map(item => {
        return { ...item, groupId: group.id }
      }),
    }
  })

  const flatData = dataWithIds.flatMap(group => [group.title, ...group.data])

  useEffect(() => {
    groups.forEach(group => {
      if (group.id && group.page) {
        dispatch(
          FetchAlbumDate.action({
            album_date_id: group.id,
            page: group.page,
            photosetType: 'timestamp',
          }),
        )
      }
    })
  }, [groups, dispatch])

  /**
   * Handles the press event for an image in the list.
   * @param item An object representing the data item that was pressed.
   * @param index The index of the item in the list.
   * @param section The section the item is in.
   */
  const handleImagePress = (item, index, section) => {
    const relevantGroup = data.find(i => i.title === item.groupId)
      ? data.find(i => i.title === item.groupId)
      : data.find(i => i.id === item.groupId)
    const itemInGroup = relevantGroup.data.find(i => i.id === item.id)
    const indexBasedOnGroup = relevantGroup.data.indexOf(itemInGroup)
    setLightBoxVisible(true)
    setCurrImage({ item, index: indexBasedOnGroup, section })
  }

  /**
   * Sets the visibility of the lightbox to the opposite of its current state.
   */
  const onClose = () => {
    setLightBoxVisible(!lightBoxVisible)
  }

  /**
   * Renders the header of the list.
   * @param item An object representing the section to render.
   * @returns A React component that renders the section.
   */
  const renderHeader = (item: any) => {
    const title =
      item.item === 'No timestamp'
        ? 'No Timestamp'
        : moment(item.item).format('LL')
    const subtitle = moment(item.item).fromNow()
    return (
      <View style={[Gutters.regularHMargin, Gutters.smallVMargin]}>
        <Text fontSize={'xl'} color={Colors.text}>
          {title}
        </Text>
        {item.title !== 'No timestamp' && (
          <Text italic fontSize={'sm'} color={Colors.textMuted}>
            {subtitle}
          </Text>
        )}
      </View>
    )
  }

  /**
   * Renders a photo component based on input and a function to handle image press.
   * @param input The input for the photo component.
   * @returns A PhotoComponent with the given input and handleImagePress function.
   */
  const renderPhoto = (input: any): JSX.Element => {
    return <PhotoComponent input={input} handleImagePress={handleImagePress} />
  }

  /**
   * Finds the fetchable groups of the visible elements.
   * @param visibleElements The visible elements.
   */
  const findFetchableGroups = (visibleElements: any[]): void => {
    const fetchableGroups = [] as Group[]
    const visibleItems = visibleElements.map(i => i.item)
    const tempElements = visibleItems.filter(
      i => i != null && i.isTemp && i.isTemp !== undefined,
    )
    const groupBasedOnId = tempElements.reduce((acc, curr) => {
      if (acc.findIndex(i => i.id === curr.groupId) === -1) {
        acc.push({ id: curr.groupId, data: [curr] })
      } else {
        acc[acc.findIndex(i => i.id === curr.groupId)].data.push(curr)
      }
      return acc
    }, [])

    groupBasedOnId.forEach(item => {
      var visibleImages = item.data
      var firstTempObject = visibleImages.filter(i => i.isTemp)[0]
      var page = Math.ceil((parseInt(firstTempObject.id) + 1) / 100)
      fetchableGroups.push({ id: item.id, page: page })
    })
    setGroups(fetchableGroups)
  }

  /**
   * Handles the viewable items.
   * @param viewableItems The viewable items.
   */
  const onCheckViewableItems = ({
    viewableItems,
  }: {
    viewableItems: any[]
  }): void => {
    findFetchableGroups(viewableItems)
  }

  return (
    <>
      {flatData && flatData.length > 0 && (
        <View
          style={[
            {
              backgroundColor: Colors.screenBackground,
              width: '100%',
              height: '100%',
            },
          ]}
        >
          <FlashList
            data={flatData}
            onRefresh={onRefresh}
            refreshing={refreshing}
            numColumns={3}
            renderItem={input => {
              if (typeof input.item === 'string' || input.item == null) {
                return renderHeader(input)
              } else {
                return renderPhoto(input)
              }
            }}
            overrideItemLayout={(layout, item, index, maxColumns) => {
              if (typeof item === 'string' || item == null) {
                layout.span = maxColumns
              }
            }}
            estimatedItemSize={flatData.length}
            onViewableItemsChanged={onCheckViewableItems}
          />
        </View>
      )}
      {data.length < 1 && (
        <NoResultsError onRefresh={onRefresh} refreshing={refreshing} />
      )}

      <LightBox
        data={
          data.find(i => i.title === currImage.item.groupId)
            ? data.find(i => i.title === currImage.item.groupId)?.data
            : data.find(i => i.id === currImage.item.groupId)?.data
        }
        isVisible={lightBoxVisible}
        currImage={currImage}
        onClose={onClose}
      />
    </>
  )
}

TimelineList.defaultProps = {
  data: [],
}

export default TimelineList
