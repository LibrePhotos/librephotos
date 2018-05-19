import React, {Component} from 'react';
import { connect } from "react-redux";
import {Popup, Modal, Container, Icon, Divider, Header, Loader, Image, Button, Card} from 'semantic-ui-react'
import { fetchPhotoDetail, fetchNoTimestampPhotoList} from '../actions/photosActions';

import {Server, serverAddress} from '../api_client/apiClient'
import { Grid, List, WindowScroller,AutoSizer } from 'react-virtualized';
import {LightBox} from '../components/lightBox'

import { push } from 'react-router-redux'

var topMenuHeight = 55 // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;





export class NoTimestampPhotosView extends Component {

    constructor(props){
        super(props)
        this.cellRenderer = this.cellRenderer.bind(this)
        this.getRowHeight = this.getRowHeight.bind(this)
        this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)
        this.onPhotoClick = this.onPhotoClick.bind(this)
        this.getPhotoDetails = this.getPhotoDetails.bind(this)
        this.state = {
            idx2hash: [],
            lightboxImageIndex: 1,
            lightboxShow:false,
            lightboxSidebarShow:false,
            scrollToIndex: undefined,
            width:  window.innerWidth,
            height: window.innerHeight,
            entrySquareSize:200,
            currTopRenderedRowIdx:0
        }
    }
    componentWillMount() {
        this.props.dispatch(fetchNoTimestampPhotoList())
        this.calculateEntrySquareSize();
        window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
    }
    componentWillUnmount() {
        window.removeEventListener("resize",this.calculateEntrySquareSize.bind(this))
    }

    calculateEntrySquareSize() {
        if (window.innerWidth < 600) {
            var numEntrySquaresPerRow = 3
        } 
        else if (window.innerWidth < 800) {
            var numEntrySquaresPerRow = 4
        }
        else if (window.innerWidth < 1000) {
            var numEntrySquaresPerRow = 5
        }
        else if (window.innerWidth < 1200) {
            var numEntrySquaresPerRow = 6
        }
        else {
            var numEntrySquaresPerRow = 8
        }

        var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 15


        var entrySquareSize = columnWidth / numEntrySquaresPerRow
        var numEntrySquaresPerRow = numEntrySquaresPerRow
        this.setState({
            width:  window.innerWidth,
            height: window.innerHeight,
            entrySquareSize:entrySquareSize,
            numEntrySquaresPerRow:numEntrySquaresPerRow
        })
    }

    cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
        var photoResIdx = rowIndex * this.state.numEntrySquaresPerRow + columnIndex
        if (photoResIdx < this.props.noTimestampPhotos.length) {
        	if (this.props.noTimestampPhotos[photoResIdx].image_hash.length > 0) {
	            return (
	                <div key={key} style={style}>
	                    <div style={{backgroundColor:'white',paddingRight:5}}>
	                    <Image 
	                        onClick={()=>this.onPhotoClick(photoResIdx)}
	                        src={serverAddress+'/media/square_thumbnails/'+this.props.noTimestampPhotos[photoResIdx].image_hash+'.jpg'}/>
	                    </div>
	                </div>
	            )
        	} else {
	            return (
	                <div key={key} style={style}>
	                    <div style={{backgroundColor:'white',paddingRight:5}}>
                        <div style={{
                            backgroundColor:'#eeeeee',
                            height:this.state.entrySquareSize,
                            width:this.state.entrySquareSize}}>
                            Missing image
                        </div>
	                    </div>
	                </div>
	            )

        	}
        } else {
            return (<div></div>)
        }
    }


    getRowHeight = ({index}) => {
        var rowHeight = this.state.entrySquareSize 
        return (
            rowHeight
        )
    }


    onPhotoClick(idx) {
        if (this.state.idx2hash.length != this.props.noTimestampPhotos.length) {
            this.setState({idx2hash:this.props.noTimestampPhotos.map((el)=>el.image_hash)})
        }
        this.setState({lightboxImageIndex:idx,lightboxShow:true})

    }

    _setRef = windowScroller => {
        this._windowScroller = windowScroller;
    };
    
    getPhotoDetails(image_hash) {
        if (!this.props.photoDetails.hasOwnProperty(image_hash)) {
            this.props.dispatch(fetchPhotoDetail(image_hash))
        }
    }

    render() {

        if ( this.props.searchingPhotos ) {
            if ( this.props.query ) {
                return (
                    <div>
                        <Loader active>
                        </Loader>
                    </div>
                )
            }
        }
        // else {
        //     return (
        //         <div style={{padding:100}}> 
        //             <Header textAlign='center'>
        //             Search for something using the search bar on the top right
        //             </Header>
        //         </div>
        //     )
        // }

        return (
            <div style={{}}>

                <div style={{height:60,paddingTop:10}}>

                  <Header as='h2'>
                    <Icon name='picture' />
                    <Header.Content>
                      Photos without Timestamps
                      <Header.Subheader>
                        {this.props.noTimestampPhotos.length} Photos
                      </Header.Subheader>
                    </Header.Content>
                  </Header>

                </div>


                <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0}}>
                  {({width}) => (
                    <Grid
                      cellRenderer={this.cellRenderer}
                      columnWidth={this.state.entrySquareSize}
                      columnCount={this.state.numEntrySquaresPerRow}
                      height={this.state.height - topMenuHeight -60 }
                      rowHeight={this.state.entrySquareSize}
                      rowCount={Math.ceil(this.props.noTimestampPhotos.length/this.state.numEntrySquaresPerRow.toFixed(1))}
                      width={width}/>
                  )}
                </AutoSizer>

                { this.state.lightboxShow &&
                    <LightBox
                        idx2hash={this.state.idx2hash}
                        lightboxImageIndex={this.state.lightboxImageIndex}

                        onCloseRequest={() => this.setState({ lightboxShow: false })}
                        onImageLoad={()=>{
                            this.getPhotoDetails(this.state.idx2hash[this.state.lightboxImageIndex])
                        }}
                        onMovePrevRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.state.idx2hash.length - 1) % this.state.idx2hash.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            this.getPhotoDetails(this.state.idx2hash[nextIndex])
                        }}
                        onMoveNextRequest={() => {
                            var nextIndex = (this.state.lightboxImageIndex + this.state.idx2hash.length + 1) % this.state.idx2hash.length
                            this.setState({
                                lightboxImageIndex:nextIndex
                            })
                            this.getPhotoDetails(this.state.idx2hash[nextIndex])
                        }}/>
                }


            </div>
            
        )
    }
}


NoTimestampPhotosView = connect((store)=>{
  return {
  	fetchingNoTimestampPhotos: store.photos.fetchingNoTimestampPhotos,
	fetchedNoTimestampPhotos: store.photos.fetchedNoTimestampPhotos,
    noTimestampPhotos: store.photos.noTimestampPhotos,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
  }
})(NoTimestampPhotosView)


