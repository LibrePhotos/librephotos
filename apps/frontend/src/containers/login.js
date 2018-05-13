import React from 'react'
import { connect } from 'react-redux'
import { Redirect } from 'react-router-dom'
import {LoginPage} from '../layouts/loginPage'
import {login} from  '../actions/authActions'
import {authErrors, isAuthenticated, isRefreshTokenExpired} from '../reducers'


const Login = (props) => {
  if(props.isAuthenticated) {
    console.log('redirecting to ',props.location.state.from.pathname)
    return (
      <Redirect to={props.location.state.from.pathname} />
    )
  } else {
    console.log(props)
    return (
      <div className="login-page">
        <LoginPage {...props}/>
      </div>
    )
  }
}

const mapStateToProps = (state) => ({
  errors: authErrors(state),
  isAuthenticated: !isRefreshTokenExpired(state),
})

const mapDispatchToProps = (dispatch) => ({
  onSubmit: (username, password) => {
    dispatch(login(username, password))
  }
})

export default connect(mapStateToProps, mapDispatchToProps)(Login)