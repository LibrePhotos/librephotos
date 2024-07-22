import React, { useEffect, useState } from 'react'
import { View, Platform, KeyboardAvoidingView } from 'react-native'
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
import { navigateAndSimpleReset } from '@/Navigators/Root'
// To-Do: Replace this with a new API call
import { CheckServerService } from '../../Services/Config'

import { useLoginMutation } from '@/Store/api'
import {
  selectIsAuthenticated,
  selectAuthErrors,
} from '@/Store/Auth/authSelectors'
import { useAppSelector, useAppDispatch } from '@/Store/store'
import { changeBaseurl } from '@/Store/Config/configSlice'

const IndexLoginContainer = () => {
  const { Colors, Layout, Gutters } = useTheme()

  const { t } = useTranslation()

  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [isValidServer, setValidServer] = useState(false)
  const [isValidating, setServerValidation] = useState(false)

  const isLoggedin = useAppSelector(selectIsAuthenticated)
  const [login, { isLoading }] = useLoginMutation()
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (isLoggedin) {
      navigateAndSimpleReset('Main')
    }
  }, [isLoggedin])

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
    return serverName
  }

  const loginOnClick = (_evt: any) => {
    login({ username, password })
  }

  const error = useAppSelector(selectAuthErrors)

  useEffect(() => {
    setServerValidation(true)
    CheckServerService(preprocessserver(server, false)).then(isValid => {
      if (!isValid) {
        CheckServerService(preprocessserver(server, true)).then(isValid => {
          setValidServer(isValid)
          setServerValidation(false)
          const serverName = preprocessserver(server, true)
          if (isValid) {
            dispatch(changeBaseurl({ baseurl: serverName }))
          }
        })
      } else {
        setValidServer(isValid)
        setServerValidation(false)
        const serverName = preprocessserver(server, false)
        dispatch(changeBaseurl({ baseurl: serverName }))
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

        {error && error.data && error.data.detail && (
          <Alert status="danger" w="100%" style={[Gutters.largeVMargin]}>
            <Alert.Icon />
            <Text flexShrink={1}>{error.data.detail?.toString()}</Text>
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
              {/* <FormControl.HelperText>
              We'll keep this between us.
            </FormControl.HelperText> */}
              <FormControl.ErrorMessage>
                Unable to connect to the server
              </FormControl.ErrorMessage>
            </Stack>
          </FormControl>

          <FormControl w="85%" isInvalid={error?.data?.username}>
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
              {/* <FormControl.HelperText>
              We'll keep this between us.
            </FormControl.HelperText> */}
              <FormControl.ErrorMessage>
                {error?.data?.username}
              </FormControl.ErrorMessage>
            </Stack>
          </FormControl>

          <FormControl w="85%" isInvalid={error?.data?.password}>
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
              {/* <FormControl.HelperText>
              We'll keep this between us.
            </FormControl.HelperText> */}
              <FormControl.ErrorMessage>
                {error?.data?.password}
              </FormControl.ErrorMessage>
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
