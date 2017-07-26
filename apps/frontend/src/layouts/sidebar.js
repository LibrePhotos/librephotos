import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Icon } from 'semantic-ui-react';
import { connect } from "react-redux";
import {login, logout} from '../actions/authActions'

export class Sidebar extends Component {
  state = { activeItem: 'photos' }

  handleItemClick = (e, { name }) => this.setState({ activeItem: name })
  handleLogout = (e, {name}) => this.props.dispatch(logout())

  render() {
    console.log('from sidebar')
    console.log(this.props.jwtToken)
    if (this.props.jwtToken == null) {
      console.log('signed out')
      var authMenu = (
        <Menu.Item 
          name='loginout'
          as={Link}
          to='/login'>
          <Icon name='sign out' corner /> Log In
        </Menu.Item>
      )
    }
    else {
      console.log('signed in')
      var authMenu = (
        <Menu.Item 
          onClick={this.handleLogout}
          name='loginout'
          as={Link}
          to='/login'>
          <Icon name='sign in' corner /> Log Out
        </Menu.Item>
      )
    }


    const { activeItem } = this.state
    return (
      <Menu 
        color='black'
        pointing
        inverted
        stackable 
        size="small"
        vertical
        fixed='left'>


        <Menu.Item name='logo'>
          <img src='/logo-white.png'/>
        </Menu.Item>

        {authMenu}

        <Menu.Item 
          onClick={this.handleItemClick}
          active={activeItem==='all photos'}
          name='all photos'
          as={Link}
          to='/'>
          <Icon name='image' corner />Browse
        </Menu.Item>


        <Menu.Item 
          onClick={this.handleItemClick}
          active={activeItem==='search'}
          name='search'
          as={Link}
          to='/niy'>
          <Icon name='search' corner />Search
        </Menu.Item>


        <Menu.Item>
          <Menu.Header><Icon name='heart'/>Favorites</Menu.Header>
          <Menu.Menu>     
          <Menu.Item
            onClick={this.handleItemClick}
            active={activeItem==='favorites auto albums'}
            name='favorites auto albums'
            content="Events"
            as={Link}
            to='/favorite/auto'/>
          </Menu.Menu>
        </Menu.Item>


        <Menu.Item>
          <Menu.Header><Icon name='image'/>Albums</Menu.Header>
          <Menu.Menu>
            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem==='people albums'}
              content='People'
              name='people albums'
              as={Link}
              to='/albums/people'/>
            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem==='auto albums'}
              content="Events"
              name='auto albums'
              as={Link}
              to='/albums/auto'/>
            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem==='date albums'}
              content="Days"
              name='date albums'
              as={Link}
              to='/albums/date'/>
          </Menu.Menu>
        </Menu.Item>

        <Menu.Item>
          <Menu.Header><Icon name='dashboard'/>Dashboards</Menu.Header>
          <Menu.Menu>            
          <Menu.Item
            onClick={this.handleItemClick}
            active={activeItem==='faces dashboard'}
            name='faces dashboard'
            content='Faces'
            as={Link}
            to='/faces'/>
          <Menu.Item
            onClick={this.handleItemClick}
            active={activeItem==='people dashboard'}
            name='people dashboard'
            content='People'
            as={Link}
            to='/people'/>

          <Menu.Item
            onClick={this.handleItemClick}
            active={activeItem==='statistics'}
            name='statistics'
            content="Statistics"
            as={Link}
            to='/statistics'/>
          </Menu.Menu>
        </Menu.Item>
      </Menu>
    )
  }
}




Sidebar = connect((store)=>{
  return {
    jwtToken: store.auth.jwtToken
  }
})(Sidebar)