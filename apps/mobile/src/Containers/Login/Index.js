import React, { useEffect, useState } from 'react'
import { ActivityIndicator, View, Text } from 'react-native'
import { Alert, Button, Input, Stack, Center } from 'native-base'
import { useDispatch, useSelector } from 'react-redux'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/Theme'
import LoginUser from '@/Store/Auth/LoginUser'
import { Brand } from '@/Components'
import { navigateAndSimpleReset } from '@/Navigators/Root'

const IndexLoginContainer = () => {
  const { Colors, Layout, Gutters, Fonts } = useTheme()

  const { t } = useTranslation()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const isLoggedin = useSelector(state => state.auth.isLoggedin)

  useEffect(() => {
    if (isLoggedin) {
      navigateAndSimpleReset('Main')
    }
  }, [isLoggedin])

  const dispatch = useDispatch()

  const login = evt => {
    dispatch(LoginUser.action([username, password]))
  }

  const error = useSelector(state => state.auth.error)

  //   useEffect(() => {
  //     dispatch(InitStartup.action())
  //   }, [dispatch])

  return (
    <View style={[Layout.fill, Layout.colCenter]}>
      <Brand />

      {error && error.data && (
        <Alert status="danger" w="100%" style={[Gutters.largeTMargin]}>
          <Alert.Icon />
          <Alert.Title flexShrink={1}>{error.data.detail}</Alert.Title>
        </Alert>
      )}

      <Input
        onChangeText={setUsername}
        w="80%"
        mx={3}
        placeholder={t('auth.label.username')}
        style={[Gutters.largeTMargin]}
        placeholderTextColor={Colors.textLight}
      />
      <Input
        onChangeText={setPassword}
        w="80%"
        mx={3}
        placeholder={t('auth.label.password')}
        type="password"
        style={[Gutters.smallTMargin]}
        placeholderTextColor={Colors.textLight}
      />

      <Button
        onPress={login}
        isLoading={useSelector(state => state.auth.loading)}
        colorScheme={Colors.primaryNB}
        style={[Gutters.largeTMargin]}
      >
        {t('auth.label.submit')}
      </Button>
    </View>
  )
}

export default IndexLoginContainer
