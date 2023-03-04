import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import {
  IndexSearchContainer,
  GalleryContainer,
  AlbumContainer,
  SettingsContainer,
} from '@/Containers'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'

const Tab = createBottomTabNavigator()

const renderIcon = (name, color, size) => (
  <MaterialCommunityIcons name={name} color={color} size={size} />
)

// @refresh reset
const MainNavigator = () => {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen
        name="Photos"
        component={GalleryContainer}
        options={{
          tabBarLabel: 'Photos',
          tabBarIcon: ({ color, size }) => renderIcon('image', color, size),
        }}
      />
      <Tab.Screen
        name="Search"
        component={IndexSearchContainer}
        options={{
          tabBarLabel: 'Search',
          tabBarIcon: ({ color, size }) => renderIcon('magnify', color, size),
        }}
      />
      <Tab.Screen
        name="Albums"
        component={AlbumContainer}
        options={{
          tabBarLabel: 'Albums',
          tabBarIcon: ({ color, size }) =>
            renderIcon('image-multiple', color, size),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsContainer}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) =>
            renderIcon('account-cog', color, size),
        }}
      />
    </Tab.Navigator>
  )
}

export default MainNavigator
