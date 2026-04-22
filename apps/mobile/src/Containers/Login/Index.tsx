import React, { useEffect, useState } from 'react'
import { View, Platform, KeyboardAvoidingView } from 'react-native'
// @ts-ignore
const isDev = __DEV__
import {
  Alert,
  Button,
  Icon,
  Input,
  VStack,
  Spinner,
  Stack,
  ScrollView,
  FormControl,
  Text,
} from 'native-base'
import FeatherIcon from 'react-native-vector-icons/Feather'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/Theme'
import { Brand } from '@/Components'
// To-Do: Replace this with a new API call
import { CheckServerService } from '../../Services/Config'

import { useLoginMutation } from '@/api_client/auth'
import { useIsAuthenticatedQuery } from '@/api_client/auth'
import { useConfigStore } from '@/stores/configStore'
import { navigateAndSimpleReset } from '@/Navigators/Root'

const IndexLoginContainer = () => {
  const { Colors, Layout, Gutters } = useTheme()

  const { t } = useTranslation()

  // Pre-populate server from stored config (strip protocol for display)
  const storedBaseurl = useConfigStore(s => s.baseurl)
  const [server, setServer] = useState(() => {
    if (!storedBaseurl) return ''
    // Show just the host:port part so preprocessserver can re-add protocol
    return storedBaseurl
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
  })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [isValidServer, setValidServer] = useState(false)
  const [isValidating, setServerValidation] = useState(false)
  const [loginError, setLoginError] = useState<any>(null)

  const { data: isAuthenticated } = useIsAuthenticatedQuery()
  const { mutate: login, isPending: isLoading } = useLoginMutation({
    navigateOnSuccess: true,
  })

  useEffect(() => {
    if (isAuthenticated) {
      navigateAndSimpleReset('Main')
    }
  }, [isAuthenticated])

  const preprocessserver = (serverInput: string, secure: boolean) => {
    let serverName = serverInput.trim().toLowerCase()

    if (
      !serverName.startsWith('http://') &&
      !serverName.startsWith('https://')
    ) {
      serverName = 'http' + (secure ? 's' : '') + '://' + serverName
    }

    if (serverName.endsWith('/')) {
      serverName = serverName.substring(0, serverName.length - 1)
    }

    // On Android emulator, localhost refers to the emulator itself.
    // Replace with 10.0.2.2 to reach the host machine in dev mode.
    if (isDev && Platform.OS === 'android') {
      serverName = serverName.replace('://localhost', '://10.0.2.2')
    }

    return serverName
  }

  const loginOnClick = (_evt: any) => {
    setLoginError(null)
    login(
      { username, password },
      {
        onError: (error: any) => {
          setLoginError(error)
        },
      },
    )
  }

  useEffect(() => {
    setServerValidation(true)
    CheckServerService(preprocessserver(server, false)).then(isValid => {
      if (!isValid) {
        CheckServerService(preprocessserver(server, true)).then(isValid => {
          setValidServer(isValid)
          setServerValidation(false)
          const serverName = preprocessserver(server, true)
          if (isValid) {
            useConfigStore.getState().changeBaseurl({ baseurl: serverName })
          }
        })
      } else {
        setValidServer(isValid)
        setServerValidation(false)
        const serverName = preprocessserver(server, false)
        useConfigStore.getState().changeBaseurl({ baseurl: serverName })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server])

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[Layout.fill]}
    >
      <ScrollView style={[Gutters.largeTPadding]}>
        <View style={[Gutters.largeVMargin, Layout.colCenter]}>
          <Brand />
        </View>

        {loginError && (
          <Alert status="danger" w="100%" style={[Gutters.largeVMargin]}>
            <Alert.Icon />
            <Text flexShrink={1}>{loginError?.message || 'Login failed'}</Text>
          </Alert>
        )}

        <VStack space={4} alignItems="center">
          <FormControl
            w="85%"
            isInvalid={!isValidServer && server.length !== 0}
          >
            <Stack mx={4}>
              <FormControl.Label>Server Name</FormControl.Label>
              <Input
                onChangeText={setServer}
                autoComplete={'off'}
                autoCorrect={false}
                autoCapitalize={'none'}
                value={server}
                color={Colors.text}
                placeholder={'http://localhost:3000'}
                placeholderTextColor={Colors.textLight}
                InputRightElement={
                  <>
                    {server.length !== 0 &&
                      (isValidating ? (
                        <Spinner color="blue.500" />
                      ) : isValidServer ? (
                        <Icon
                          as={<FeatherIcon name="check" />}
                          size="md"
                          m={2}
                          color="green"
                        />
                      ) : (
                        <Icon
                          as={<FeatherIcon name="alert-triangle" />}
                          size="md"
                          m={2}
                          color="red"
                        />
                      ))}
                  </>
                }
              />
              <FormControl.ErrorMessage>
                Unable to connect to the server
              </FormControl.ErrorMessage>
            </Stack>
          </FormControl>

          <FormControl w="85%" isInvalid={!!loginError}>
            <Stack mx={4}>
              <FormControl.Label>Username</FormControl.Label>
              <Input
                onChangeText={setUsername}
                value={username}
                autoCapitalize={'none'}
                color={Colors.text}
                placeholder={t('auth.label.username')?.toString()}
                placeholderTextColor={Colors.textLight}
              />
            </Stack>
          </FormControl>

          <FormControl w="85%" isInvalid={!!loginError}>
            <Stack mx={4}>
              <FormControl.Label>Password</FormControl.Label>
              <Input
                onChangeText={setPassword}
                value={password}
                placeholder={t('auth.label.password')?.toString()}
                color={Colors.text}
                type="password"
                placeholderTextColor={Colors.textLight}
              />
            </Stack>
          </FormControl>

          <Button
            onPress={loginOnClick}
            isLoading={isLoading}
            colorScheme={Colors.primaryNB}
            style={[Gutters.largeTMargin]}
          >
            {t('auth.label.submit')}
          </Button>
        </VStack>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export default IndexLoginContainer
