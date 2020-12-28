import React               from 'react';  
import { Route, Redirect } from 'react-router-dom'  
import { AllPhotosViewLL } from './layouts/allPhotosViewLL'


export default function configRoutes() {  
  return (
    <div>
      <Navigation />
      <Route exact path="/" component={AllPhotosViewLL} />
      <Route path="/login" component={loginPage} />
      <AuthenticatedRoute path="/photos" component={allPhotosGroupedByDate} />
    </div>
  );
}

const AuthenticatedRoute = ({ component: Component, ...rest }) => (  
  <Route {...rest} render={props => (
    localStorage.getItem('phoenixAuthToken') ? (
      <Component {...props}/>
    ) : (
      <Redirect to={{
        pathname: '/sign_in',
        state: { from: props.location }
      }}/>
    )
  )}/>
)