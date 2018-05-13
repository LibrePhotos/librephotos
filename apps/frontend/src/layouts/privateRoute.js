

import React from 'react'
import { connect } from 'react-redux'
import * as reducers from '../reducers'
import {
  BrowserRouter as Router,
  Route,
  Switch,
  Redirect
} from 'react-router-dom'
import {SideMenuNarrow, TopMenu} from './menubars'

var topMenuHeight = 55 // don't change this
var leftMenuWidth = 85 // don't change this

      // <div>
      //   <Nav />
      //   <Component {...props}/>
      // </div>


const PrivateRoute = ({ component: Component, isAuthenticated, ...rest }) => {
  console.log(isAuthenticated)
  return (
    <Route {...rest} render={props => (
      isAuthenticated ? (
        <div>
          <div style={{paddingLeft:leftMenuWidth+5,paddingRight:0}}>
            <div style={{paddingTop:topMenuHeight}}>
              <Component {...props}/>
            </div>
          </div>
        </div>
      ) : (
        <Redirect to={{
          pathname: '/login',
          state: { from: props.location }
        }}/>
      )
    )}/>
  )
}





class Nav extends React.Component {
  render() {
    return (
      <div>
        <SideMenuNarrow visible={true}/>
        <TopMenu style={{zIndex:-1}}/>
      </div>
    )
  }
}


const mapStateToProps = (state) => ({
      isAuthenticated: !reducers.isRefreshTokenExpired(state)
})

export default connect(mapStateToProps, null)(PrivateRoute);
