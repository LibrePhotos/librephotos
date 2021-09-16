import React from 'react'
import { useToast, Pressable } from 'native-base'
import { SettingItem } from './SettingItem'

export const OptionToggle = ({
  title,
  value,
  subTitle = '',
  onPress = null,
  icon = null,
}) => {
  const toast = useToast()
  if (onPress == null) {
    onPress = () => {
      toast.show({ title: 'Not Implemented', duration: 1000 })
    }
  }

  return (
    <Pressable onPress={onPress}>
      <SettingItem
        title={title}
        subTitle={subTitle}
        icon={icon}
        toggleValue={value}
        onToggle={onPress}
      />
    </Pressable>
  )
}
