import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { Popup,Menu, Input, Icon, Sidebar, Divider, Image, Header } from 'semantic-ui-react';
import { connect } from "react-redux";
import {login, logout} from '../actions/authActions'
import {searchPhotos} from '../actions/searchActions'
import {fetchExampleSearchTerms} from '../actions/utilActions'
import { push } from 'react-router-redux'
import store from '../store'

var ENTER_KEY = 13;
var topMenuHeight = 55 // don't change this

export class TopMenu extends Component {
  state = {
    searchText:'',
    warningPopupOpen:false,
    showEmptyQueryWarning:false,
    width:window.innerWidth,
    exampleSearchTerm:'Search...',

  }

  constructor(props) {
    super(props)
    this.handleSearch = this.handleSearch.bind(this)
    this.handleChange = this.handleChange.bind(this)
    this.handleResize = this.handleResize.bind(this)
    this._handleKeyDown = this._handleKeyDown.bind(this)
  }

  handleResize() {
    this.setState({width:window.innerWidth})
  }


  componentWillMount() {
      this.props.dispatch(fetchExampleSearchTerms())
      window.addEventListener('resize',this.handleResize.bind(this))
      this.exampleSearchTermCylcer = setInterval(()=>{
        this.setState({exampleSearchTerm:  'Search ' + this.props.exampleSearchTerms[Math.floor(Math.random()*this.props.exampleSearchTerms.length)]})
      },5000)
  }

  componentWillUnmount() {
      window.removeEventListener('resize',this.handleResize.bind(this))
  }

  _handleKeyDown (event) {
      switch( event.keyCode ) {
          case ENTER_KEY:
              this.props.dispatch(searchPhotos(this.state.searchText))
              this.props.dispatch(push('/search'))
              break;
          default: 
              break;
      }
  }


  handleSearch(e,d) {
    if (this.state.searchText.length > 0){
      this.props.dispatch(searchPhotos(this.state.searchText))
      this.props.dispatch(push('/search'))
    } else {
      this.setState({ warningPopupOpen: true,showEmptyQueryWarning:true })
      this.timeout = setTimeout(() => {
        this.setState({ warningPopupOpen: false,showEmptyQueryWarning:true })
      }, 2500)
    }
  }

  handleChange(e,d) {
    this.state.searchText = d.value
  }

  render() {
    var searchBarWidth = this.state.width > 600 ? 500 : this.state.width
    return (
      <Menu style={{height:topMenuHeight,padding:10,contentAlign:'left',backgroundColor:'#eeeeee'}} borderless fixed='top' size='small' widths={1}>

          {
            this.state.width > 600 &&
            <div style={{paddingLeft:25,width:(window.innerWidth-searchBarWidth)/2,left:0,position:'absolute',textAlign:'left'}}>
            <img src="/logo-inverted-square-padded.png" style={{height:35}}/>
            </div>
          }

          <div style={{width:searchBarWidth,paddingRight:10,paddingLeft:10}}>
          <Popup trigger={
            <Input 
              fluid
              onChange={this.handleChange}
              action={{ 
                icon: 'search', 
                color:'blue',
                loading:this.props.searchingPhotos, 
                onClick:this.handleSearch,
              }} 
              placeholder={this.state.exampleSearchTerm} />}
            inverted
            open={this.state.warningPopupOpen}
            position='bottom left'
            content={
              this.state.showEmptyQueryWarning ? 
              ("Search query cannot be empty!") :
              ("You can search for people, location, and things.")
            }/>
          </div>

          <div style={{paddingRight:10,width:(window.innerWidth-searchBarWidth)/2,right:0,position:'absolute',textAlign:'right'}}>
          </div>

      </Menu>
    )  
  }
}



export class SideMenuNarrow extends Component {
  state = { activeItem: 'all photos' }

  handleItemClick = (e, { name }) => this.setState({ activeItem: name })
  handleLogout = (e, {name}) => this.props.dispatch(logout())

  render() {

      var authMenu = (
        <Menu.Item 
          onClick={this.handleLogout}
          name='loginout'>
          <Popup 
            inverted
            size='mini'
            position='right center'
            content="Sign out"
            trigger={
              <Icon name='sign out' corner />}/>
        </Menu.Item>
      )
    

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


        <Menu.Item 
          onClick={this.handleItemClick}
          active={'/'===this.props.location.pathname}
          name='all photos'
          as={Link}
          to='/'>
          <Popup 
            inverted
            size='mini'
            position='right center'
            content="All Photos"
            trigger={
              <Icon name='camera' corner />}/>
        </Menu.Item>


        <Menu.Item 
          onClick={this.handleItemClick}
          active={this.props.location.pathname.startsWith('/notimestamp')}
          name='no timestamp photos'
          as={Link}
          to='/notimestamp'>
          <Popup 
            inverted
            size='mini'
            position='right center'
            content="Photos without timestamps"
            trigger={
              <Icon name='image' corner />}/>
        </Menu.Item>


        <Divider hidden/>


        <Menu.Item
          onClick={this.handleItemClick}
          active={this.props.location.pathname.startsWith('/people') || this.props.location.pathname.startsWith('/person')}
          content='People'
          name='people'
          as={Link}
          to='/people'>
          <Popup 
            inverted
            size='mini'
            position='right center'
            content="People"
            trigger={
            <Icon name='users' corner />}/>
        </Menu.Item>

        <Menu.Item
          onClick={this.handleItemClick}
          active={this.props.location.pathname.startsWith('/thing') }
          content='People'
          name='things'
          as={Link}
          to='/things'>
          <Popup 
            inverted
            size='mini'
            position='right center'
            content="Things"
            trigger={
              <Icon name='tags' corner />}/>
        </Menu.Item>


        <Menu.Item
          onClick={this.handleItemClick}
          active={this.props.location.pathname.startsWith('/place')}
          content='Places'
          name='places'
          as={Link}
          to='/places'>
          <Popup 
            inverted
            size='mini'
            position='right center'
            content="Places"
            trigger={
            <Icon name='map outline' corner />}/>
        </Menu.Item>




        <Menu.Item
          onClick={this.handleItemClick}
          active={this.props.location.pathname.startsWith('/event')}
          content="Events"
          name='auto albums'
          as={Link}
          to='/events'>
          <Popup 
            inverted
            size='mini'
            position='right center'
            content="Events"
            trigger={
              <Icon name='wizard' corner />}/>
        </Menu.Item>




        <Divider hidden/>

        <Menu.Item
          onClick={this.handleItemClick}
          active={this.props.location.pathname.startsWith('/statistics')}
          name='statistics'
          content="Statistics"
          as={Link}
          to='/statistics'>
          <Popup 
            inverted
            size='mini'
            position='right center'
            content="Cool Graphs"
            trigger={
            <Icon name='bar chart' corner />}/>
        </Menu.Item>

        <Menu.Item
          onClick={this.handleItemClick}
          active={this.props.location.pathname.startsWith('/faces')}
          name='faces'
          content="Faces"
          as={Link}
          to='/faces'>
          <Popup 
            inverted
            size='mini'
            position='right center'
            content="Face Dashboard"
            trigger={
            <Icon name='user circle outline' corner />}/>
        </Menu.Item>


        <Menu.Item
          onClick={this.handleItemClick}
          active={this.props.location.pathname.startsWith('/setting')}
          name='settings'
          content="Settings"
          as={Link}
          to='/settings'>
          <Popup 
            inverted
            size='mini'
            position='right center'
            content="Settings"
            trigger={
            <Icon name='options' corner />}/>
        </Menu.Item>

        <Divider hidden/>

        {authMenu}

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

TopMenu = connect((store)=>{
  return {
    jwtToken: store.auth.jwtToken,
    exampleSearchTerms: store.util.exampleSearchTerms,
    searchError: store.search.error,
    searchingPhotos: store.search.searchingPhotos,
    searchedPhotos: store.search.searchedPhotos
  }
})(TopMenu)

SideMenuNarrow = connect((store)=>{
  return {
    jwtToken: store.auth.jwtToken,
    location: store.routerReducer.location
  }
})(SideMenuNarrow)
