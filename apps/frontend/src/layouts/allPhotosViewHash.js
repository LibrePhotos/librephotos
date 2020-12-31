import React, { Component } from 'react';
import { Image, Header } from 'semantic-ui-react';
import { connect } from "react-redux";
import { fetchDateAlbumsPhotoHashList } from '../actions/albumsActions'
import { serverAddress } from '../api_client/apiClient'
import LazyLoad from 'react-lazyload';


var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;


class DayGroupPlaceholder extends Component {
    render () {
        var photos = this.props.day.photos.map(function(photo) {
            return (
            <Image key={'daygroup_placholder_image_'+photo.image_hash} style={{display:'inline-block',padding:1,margin:0}}
                height={this.props.itemSize} 
                width={this.props.itemSize} 
                src={serverAddress+'/media/square_thumbnails_tiny/'+photo.image_hash+'.jpg'}/>
            )
        },this)
        var gridHeight = this.props.itemSize * Math.ceil(this.props.day.photos.length/this.props.numItemsPerRow.toFixed(1))
        return (
            <div key={'daygroup_placeholder_'+this.props.day}style={{paddingTop:20}}>
                <Header dividing as='h2'>{this.props.day.date}...</Header>
                <div style={{height:gridHeight}}>

                </div>
            </div>
        )
    }
}


class DayGroup extends Component {
    render () {
        var photos = this.props.day.photos.map(function(photo) {
            return (
                <LazyLoad 
                    key={'daygroup_photos_'+photo.image_hash}
                    once
                    offset={100}
                    placeholder={
                        <div style={{display:'inline-block',padding:1,margin:0}}></div>
                    }
                    >
                        <Image key={'daygroup_image_'+photo.image_hash} style={{display:'inline-block',padding:1,margin:0}}
                            height={this.props.itemSize} 
                            width={this.props.itemSize} 
                            src={serverAddress+'/media/square_thumbnails_small/'+photo.image_hash+'.jpg'}/>
                </LazyLoad>
            )
        },this)
        var gridHeight = this.props.itemSize * Math.ceil(this.props.day.photos.length/this.props.numItemsPerRow.toFixed(1))
        return (
            <LazyLoad 
                key={'daygroup_grid_'+this.props.day}
                once 
                offset={500}
                placeholder={
                    <DayGroupPlaceholder 
                        numItemsPerRow={this.props.numItemsPerRow} 
                        itemSize={this.props.itemSize} 
                        day={this.props.day}/>}>
                <div style={{paddingTop:20}}>
                    <Header dividing as='h2'>{this.props.day.date}</Header>
                    <div style={{height:gridHeight}}>
                    {photos}
                    </div>
                </div>
            </LazyLoad>
        )
    }
}


export class AllPhotosHashListView extends Component {
    constructor(props){
        super(props)
        this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)
        this.setState({
            width:  window.innerWidth,
            height: window.innerHeight,
            entrySquareSize:200
        })
    }
    componentWillMount() {
        if (this.props.albumsDatePhotoHashList.length < 1) {
            this.props.dispatch(fetchDateAlbumsPhotoHashList())
        }
        this.calculateEntrySquareSize();
        window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
        
    }

    calculateEntrySquareSize() {
        if (window.innerWidth < 600) {
            var numEntrySquaresPerRow = 2
        } 
        else if (window.innerWidth < 800) {
            var numEntrySquaresPerRow = 3
        }
        else if (window.innerWidth < 1000) {
            var numEntrySquaresPerRow = 4
        }
        else if (window.innerWidth < 1200) {
            var numEntrySquaresPerRow = 5
        }
        else {
            var numEntrySquaresPerRow = 6
        }

        var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15


        var entrySquareSize = columnWidth / numEntrySquaresPerRow
        var numEntrySquaresPerRow = numEntrySquaresPerRow
        this.setState({
            width:  window.innerWidth,
            height: window.innerHeight,
            entrySquareSize:entrySquareSize,
            numEntrySquaresPerRow:numEntrySquaresPerRow
        })
        console.log('column width:',columnWidth)
        console.log('item size:',entrySquareSize)
        console.log('num items per row',numEntrySquaresPerRow)
    }

    render () {
        if (this.props.fetchingAlbumsDatePhotoHashList) {
            return (<div><Loader active/></div>)
        }
        else {
            console.time('someFunction');
            var pageContent = this.props.albumsDatePhotoHashList.map(function(day){
                return (
                    <DayGroup 
                        key={'daygroup_'+day.date}
                        day={day} 
                        itemSize={this.state.entrySquareSize} 
                        numItemsPerRow={this.state.numEntrySquaresPerRow}/>
                )
            },this)
            console.timeEnd('someFunction');
        }


        return (
            <div>{pageContent}</div>
        )
    }
}


AllPhotosHashListView = connect((store)=>{
  return {
    albumsDatePhotoHashList: store.albums.albumsDatePhotoHashList,
    fetchingAlbumsDatePhotoHashList: store.albums.fetchingAlbumsDatePhotoHashList,
    fetchedAlbumsDatePhotoHashList: store.albums.fetchedAlbumsDatePhotoHashList,    
  }
})(AllPhotosHashListView)
