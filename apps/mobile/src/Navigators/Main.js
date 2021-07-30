import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { IndexExampleContainer } from '@/Containers'

const Tab = createBottomTabNavigator()

// @refresh reset
const MainNavigator = () => {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={IndexExampleContainer} />
      <Tab.Screen name="Search" component={IndexExampleContainer} />
      <Tab.Screen name="Settings" component={IndexExampleContainer} />
    </Tab.Navigator>
  )
}

export default MainNavigator
