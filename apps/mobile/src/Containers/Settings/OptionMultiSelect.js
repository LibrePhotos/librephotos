import React, { useState } from 'react'
import { Actionsheet, Pressable } from 'native-base'
import { useTheme } from '@/Theme'
import { SettingItem } from './SettingItem'

export const OptionMultiSelect = ({
  title,
  options,
  subTitle = '',
  onSelect = () => {},
  icon = null,
}) => {
  const { Colors } = useTheme()
  const [isOpen, openModal] = useState(false)

  const renderOptions = () => {
    return options.map((option, index) => (
      <Actionsheet.Item
        key={index}
        _text={{
          color: Colors.text,
        }}
        onPress={() => {
          openModal(false)
          onSelect(option)
        }}
      >
        {option}
      </Actionsheet.Item>
    ))
  }

  return (
    <>
      <Pressable onPress={() => openModal(true)}>
        <SettingItem title={title} subTitle={subTitle} icon={icon} />
      </Pressable>
      <Actionsheet
        background={Colors.screenBackground}
        isOpen={isOpen}
        onClose={() => openModal(false)}
      >
        <Actionsheet.Content bgColor={Colors.modalBackground}>
          {renderOptions()}
        </Actionsheet.Content>
      </Actionsheet>
    </>
  )
}
