import React, { useEffect, useRef, useState } from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { IndexStartupContainer, IndexLoginContainer } from '@/Containers'
import { useSelector } from 'react-redux'
import { NavigationContainer } from '@react-navigation/native'
import { navigationRef } from '@/Navigators/Root'
import { AppState, SafeAreaView, StatusBar } from 'react-native'
import { useTheme } from '@/Theme'
import { AlbumListContainer, GalleryListContainer } from '../Containers'

const Stack = createStackNavigator()

let MainNavigator

// @refresh reset
const ApplicationNavigator = () => {
  const { Layout, darkMode, NavigationTheme } = useTheme()
  const { colors } = NavigationTheme
  const [isApplicationLoaded, setIsApplicationLoaded] = useState(false)
  const applicationIsLoading = useSelector(state => state.startup.loading)

  let appStateChangeEvt = useRef()

  useEffect(() => {
    appStateChangeEvt.current = AppState.addEventListener('change', state => {
      console.log(state)
    })

    if (MainNavigator == null && !applicationIsLoading) {
      MainNavigator = require('@/Navigators/Main').default
      setIsApplicationLoaded(true)
    }
  }, [applicationIsLoading])

  // on destroy needed to be able to reset when app close in background (Android)
  useEffect(
    () => () => {
      setIsApplicationLoaded(false)
      MainNavigator = null
      appStateChangeEvt.current.remove()
    },
    [],
  )

  return (
    <SafeAreaView style={[Layout.fill, { backgroundColor: colors.card }]}>
      <NavigationContainer theme={NavigationTheme} ref={navigationRef}>
        <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} />
        <Stack.Navigator headerMode={'none'}>
          <Stack.Screen name="Startup" component={IndexStartupContainer} />
          {isApplicationLoaded && (
            <Stack.Screen
              name="Login"
              component={IndexLoginContainer}
              options={{
                animationEnabled: false,
              }}
            />
          )}
          {isApplicationLoaded && MainNavigator != null && (
            <Stack.Screen
              name="Main"
              component={MainNavigator}
              options={{
                animationEnabled: false,
              }}
            />
          )}
          <Stack.Screen
            name="AlbumList"
            component={AlbumListContainer}
            options={{
              animationEnabled: true,
            }}
          />
          <Stack.Screen
            name="PhotoList"
            component={GalleryListContainer}
            options={{
              animationEnabled: true,
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  )
}

export default ApplicationNavigator
