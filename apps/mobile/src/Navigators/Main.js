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

// @refresh reset
const MainNavigator = () => {
  return (
    <Tab.Navigator>
      <Tab.Screen
        name="Photos"
        component={GalleryContainer}
        options={{
          tabBarLabel: 'Photos',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="image" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Search"
        component={IndexSearchContainer}
        options={{
          tabBarLabel: 'Search',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="magnify" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Albums"
        component={AlbumContainer}
        options={{
          tabBarLabel: 'Albums',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="image-multiple"
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsContainer}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="account-cog"
              color={color}
              size={size}
            />
          ),
        }}
      />
    </Tab.Navigator>
  )
}

export default MainNavigator
