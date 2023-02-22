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
} from 'native-base'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { useDispatch, useSelector } from 'react-redux'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/Theme'
import LoginUser from '@/Store/Auth/LoginUser'
import { Brand } from '@/Components'
import { navigateAndSimpleReset } from '@/Navigators/Root'
import { CheckServerService } from '../../Services/Config'

const IndexLoginContainer = () => {
  const { Colors, Layout, Gutters } = useTheme()

  const { t } = useTranslation()

  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [isValidServer, setValidServer] = useState(false)
  const [isValidating, setServerValidation] = useState(false)
  const isLoggedin = useSelector(state => state.auth.isLoggedin)

  useEffect(() => {
    if (isLoggedin) {
      navigateAndSimpleReset('Main')
    }
  }, [isLoggedin])

  const dispatch = useDispatch()

  const login = evt => {
    dispatch(LoginUser.action({ server, username, password }))
  }

  const error = useSelector(state => state.auth.error)

  useEffect(() => {
    setServerValidation(true)
    CheckServerService(server).then(isValid => {
      setValidServer(isValid)
      setServerValidation(false)
    })
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
            <Alert.Title flexShrink={1}>
              {error.data.detail?.toString()}
            </Alert.Title>
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
                autoCompleteType={'off'}
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
                          as={<Ionicons name="checkmark" />}
                          size="md"
                          m={2}
                          color="green"
                        />
                      ) : (
                        <Icon
                          as={<Ionicons name="alert-circle-outline" />}
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
                placeholder={t('auth.label.username')}
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
                placeholder={t('auth.label.password')}
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
            onPress={login}
            isLoading={useSelector(state => state.auth.loading)}
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
