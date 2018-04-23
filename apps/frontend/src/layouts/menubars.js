import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { Popup,Menu, Input, Icon, Sidebar, Divider, Image, Header } from 'semantic-ui-react';
import { connect } from "react-redux";
import {login, logout} from '../actions/authActions'


export class TopMenu extends Component {
  render() {
    return (
      <Menu borderless fixed='top' size='small' >


        <Menu.Item>
          <Icon size='large' name='content' corner />
        </Menu.Item>

        <Menu.Item>
          <div style={{display:'inline',paddingRight:10, paddingLeft:20}}>
          <Image inline height={30} src='/logo.png'/>  
          </div>
          <b> Ownphotos </b>
        </Menu.Item>

        <Menu.Item position='right'>
          <Input className='icon' icon='search' placeholder='Search...' />
        </Menu.Item>

      </Menu>
    )  
  }
}



export class SideMenuNarrow extends Component {
  state = { activeItem: 'all photos' }

  handleItemClick = (e, { name }) => this.setState({ activeItem: name })
  handleLogout = (e, {name}) => this.props.dispatch(logout())

  render() {
    if (this.props.jwtToken == null) {
      console.log('signed out')
      var authMenu = (
        <Menu.Item 
          name='loginout'
          as={Link}
          to='/login'>
          <Popup 
            inverted
            size='mini'
            position='bottom'
            trigger={<Icon name='sign out' corner />}
            content="Sign out"/>
        </Menu.Item>
      )
    }
    else {
      var authMenu = (
        <Menu.Item 
          onClick={this.handleLogout}
          name='loginout'
          as={Link}
          to='/login'>
          <Popup 
            inverted
            size='mini'
            position='bottom'
            trigger={<Icon name='sign in' corner />}
            content="Sign in"/>
        </Menu.Item>
      )
    }


    const { activeItem } = this.state
    console.log('sidebar visible:',this.props.visible)
    return (
      <Menu 
        borderless 
        icon='labeled'
        vertical 
        fixed='left' 
        visible={this.props.visible} 
        floated 
        pointing 
        width='thin'>

        <Menu.Item name='logo'>
          <img height={40} src='/logo.png'/>
        </Menu.Item>

        {authMenu}

        <Divider hidden/>

        <Menu.Item 
          onClick={this.handleItemClick}
          active={activeItem==='all photos'}
          name='all photos'
          as={Link}
          to='/'>
          <Icon name='image' corner />
        </Menu.Item>


        <Menu.Item
          onClick={this.handleItemClick}
          active={activeItem==='date albums'}
          content="Days"
          name='date albums'
          as={Link}
          to='/albums/date'>
          <Icon name='calendar outline' corner />
        </Menu.Item>



        <Menu.Item
          onClick={this.handleItemClick}
          active={activeItem==='auto albums'}
          content="Events"
          name='auto albums'
          as={Link}
          to='/albums/auto'>
          <Icon name='wizard' corner />
        </Menu.Item>

        <Menu.Item
          onClick={this.handleItemClick}
          active={activeItem==='people albums'}
          content='People'
          name='people albums'
          as={Link}
          to='/albums/people'>
          <Icon name='users' corner />
        </Menu.Item>

        <Menu.Item
          onClick={this.handleItemClick}
          active={activeItem==='things'}
          content='People'
          name='things'
          as={Link}
          to='/things'>
          <Icon name='tags' corner />
        </Menu.Item>




        <Divider hidden/>

        <Menu.Item
          onClick={this.handleItemClick}
          active={activeItem==='statistics'}
          name='statistics'
          content="Statistics"
          as={Link}
          to='/statistics'>
          <Icon name='bar chart' corner />
        </Menu.Item>


      </Menu>
    )
  }
}


export class SideMenu extends Component {
  state = { activeItem: 'photos' }

  handleItemClick = (e, { name }) => this.setState({ activeItem: name })
  handleLogout = (e, {name}) => this.props.dispatch(logout())

  render() {
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
    console.log('sidebar visible:',this.props.visible)
    return (
        <Sidebar
          as={Menu}
          
          vertical
          fixed='left'
          width='thin'
          color='black'
          animation="overlay"
          floated
          pointing          
          borderless
          inverted
          visible={this.props.visible}>

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
            to='/search'>
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
        </Sidebar>
    )
  }
}




SideMenu = connect((store)=>{
  return {
    jwtToken: store.auth.jwtToken
  }
})(SideMenu)


SideMenuNarrow = connect((store)=>{
  return {
    jwtToken: store.auth.jwtToken
  }
})(SideMenuNarrow)
