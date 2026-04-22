/**
 * Used to navigating without the navigation prop
 * @see https://reactnavigation.org/docs/navigating-without-navigation-prop/
 *
 * You can add other navigation functions that you need and export them
 */
import * as React from 'react'
import { CommonActions } from '@react-navigation/native'
import { convertAbsoluteToRem } from 'native-base/lib/typescript/theme/tools'

export const navigationRef = React.createRef()

export function navigate(name, params) {
  navigationRef.current?.navigate(name, params)
}

export function navigateAndReset(routes = [], index = 0) {
  console.log('navigateAndReset', routes, index)
  navigationRef.current?.dispatch(
    CommonActions.reset({
      index,
      routes,
    }),
  )
}

export function navigateAndSimpleReset(name, index = 0) {
  console.log('navigateAndSimpleReset', name, index)
  navigationRef.current?.dispatch(
    CommonActions.reset({
      index,
      routes: [{ name }],
    }),
  )
}
