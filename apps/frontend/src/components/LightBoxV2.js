import React, {Component} from 'react';
import 'react-virtualized/styles.css'; // only needs to be imported once
import { connect } from "react-redux";
import { Card, Image, Header, Divider, Item, Loader, Dimmer, Sticky, Portal, Grid, List as ListSUI,
         Container, Label, Popup, Segment, Button, Icon, Table, Transition, Breadcrumb} from 'semantic-ui-react';
import {Server, serverAddress} from '../api_client/apiClient'
import Modal from 'react-modal'

var topMenuHeight = 55 // don't change this
var leftMenuWidth = 85 // don't change this
var SIDEBAR_WIDTH = 85
var timelineScrollWidth = 0
var DAY_HEADER_HEIGHT = 35

if (window.innerWidth < 600) {
    var LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth
} else {
    var LIGHTBOX_SIDEBAR_WIDTH = 360
}



const colors = [
  'red', 'orange', 'yellow', 'olive', 'green', 'teal',
  'blue', 'violet', 'purple', 'pink', 'brown', 'grey', 'black',
]

const lightboxStyles = {
    content: {
        top:0,
        left:0,
        right:0,
        bottom:0,
        position:'fixed',
        borderRadius:0,
        border:0,
        padding:0,
        backgroundColor:'rgba(0,0,0,0.8)',
    },
    overlay: {
        top:0,
        left:0,
        right:0,
        bottom:0,
        position:'fixed',
        borderRadius:0,
        border:0,
        zIndex:102
    }
}

Modal.setAppElement('#root')

export class LightBoxV2 extends Component {
    state = {
        showSidebar:false,
        width:window.innerWidth,
        height:window.innerHeight,
        photoPaneWidth:window.innerWidth,
        photoPaneHeight:window.innerWidth-55
    }

    constructor(props) {
        super(props)
        this.handleResize = this.handleResize.bind(this)
    }


    handleResize() {
        const width = window.innerWidth
        const height = window.innerHeight
        if (this.state.showSidebar) {
            var photoPaneWidth = width*0.7
        } else {
            var photoPaneWidth = width
        }
        const photoPaneHeight = height
        this.setState({width,height,photoPaneHeight,photoPaneWidth})
    }


    componentDidMount(){
        this.handleResize()
        window.addEventListener("resize", this.handleResize.bind(this));
    }


    render() {
        console.log(this.props)
        if (!this.props.photoDetails[this.props.idx2hash.slice(this.props.lightboxImageIndex)[0]]) {
            console.log('light box has not gotten main photo detail')
            var isLoading = true
            var mainSrc = '/transparentbackground.png'
            var mainSrcThumbnail = '/transparentbackground.png'
        } else {

            const photoDetail = this.props.photoDetails[this.props.idx2hash.slice(this.props.lightboxImageIndex)[0]]
            console.log('light box has got main photo detail')
            var isLoading = false
            var mainSrc = serverAddress+'/media/photos/'+this.props.idx2hash.slice(this.props.lightboxImageIndex)[0]+'.jpg'
            var mainSrcThumbnail = serverAddress+'/media/thumbnails/'+this.props.idx2hash.slice(this.props.lightboxImageIndex)[0]+'.jpg'
            
            const isPhotoLandscape = photoDetail.thumbnail_height < photoDetail.thumbnail_width
            const isViewportLandscape = this.state.photoPaneHeight < this.state.photoPaneWidth
            
            console.log('photo is landscape',isPhotoLandscape)
            console.log('viewport is landscape',isViewportLandscape)

            if (this.props.photoDetails[this.props.idx2hash.slice(this.props.lightboxImageIndex)[0]].hidden && !this.props.showHidden) {
                var mainSrc = '/hidden.png'
                var mainSrcThumbnail = '/hidden.png'
            }
            
        }
        console.log(Modal.defaultStyles)
        return (
            <Modal
              style={lightboxStyles}
              isOpen={this.props.isOpen}
              onAfterOpen={()=>{this.props.onImageLoad()}}
              onRequestClose={this.props.onCloseRequest}>

              <div style={{width:this.state.showSidebar ? '70%' : '100%',color:'#ffffff',display:'inline-block',padding:0,float:'left'}}>
                <div style={{width:'100%',padding:10,height:55,backgroundColor:'rgba(0,0,0,0.9)'}}>
                    <Button 
                        floated='right'
                        onClick={()=>{this.props.onCloseRequest()}}
                        icon
                        circular>
                        <Icon name='close'/>
                    </Button>
                    <Button 
                        floated='right'
                        onClick={()=>{this.setState({showSidebar:!this.state.showSidebar})}}
                        icon
                        circular>
                        <Icon name='info'/>
                    </Button>
                </div>
                <div style={{justifyContent:'center',height:'100%-55px',alignItems:'center'}}>
                { isLoading && <Loader inverted active/> }
                { !isLoading && <Image src={mainSrc}/> }
                </div>
              </div>

              { this.state.showSidebar &&

                <div style={{padding:10, width: '30%',height:'100%',backgroundColor:'white', display:'inline-block',float:'right'}}>
                    <Button 
                        floated='right'
                        onClick={()=>{this.setState({showSidebar:!this.state.showSidebar})}}
                        icon
                        circular>
                        <Icon name='close'/>
                    </Button>
                </div>

              }


            </Modal>
        )
    }
}

LightBoxV2 = connect((store)=>{
  return {
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
    photos:store.photos.photos,   
  }
})(LightBoxV2)
