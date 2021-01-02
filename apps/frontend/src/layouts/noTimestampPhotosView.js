import React, { Component } from 'react';
import { connect } from "react-redux";
import { fetchNoTimestampPhotoList } from '../actions/photosActions';
import _ from 'lodash'
import moment from 'moment'
import { PhotoListView } from './ReusablePhotoListView'


var topMenuHeight = 55 // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;


export class NoTimestampPhotosView extends Component {
    state = {
      photosGroupedByDate: [],
      idx2hash: [],
      albumID: null,
    }
  
    componentDidMount() {
        this.props.dispatch(fetchNoTimestampPhotoList())
    }

    static getDerivedStateFromProps(nextProps,prevState){
        const photos = nextProps.noTimestampPhotos.filter(photo=>photo.image_hash)
        if (prevState.idx2hash.length !== photos.length) {

            var t0 = performance.now();
            var groupedByDate = _.groupBy(photos,(el)=>{
                if (el.exif_timestamp) {
                    return moment(el.exif_timestamp).format('YYYY-MM-DD')
                } else {
                    return "No Timestamp"
                }
            })
            var groupedByDateList = _.reverse(_.sortBy(_.toPairsIn(groupedByDate).map((el)=>{
                return {date:el[0],photos:el[1]}
            }),(el)=>el.date))
            var idx2hash = []
            groupedByDateList.forEach((g)=>{
                g.photos.forEach((p)=>{
                    idx2hash.push(p.image_hash)
                })
            })
            var t1 = performance.now();
            console.log(t1-t0)
            return {
                ...prevState, 
                photosGroupedByDate: groupedByDateList,
                idx2hash:idx2hash,
                albumID:nextProps.match.params.albumID
            }
        } else {
            return null
        }

    }
  
  
  
    render() {
      const {fetchingNoTimestampPhotos} = this.props
      return (
        <PhotoListView 
          title={"Photos without Timestamps"}
          loading={fetchingNoTimestampPhotos}
          titleIconName={'images outline'}
          photosGroupedByDate={this.state.photosGroupedByDate}
          idx2hash={this.state.idx2hash}
        />
      )  
    }
  }



/*
export class NoTimestampPhotosView extends Component {

    constructor(props){
        super(props)
        this.cellRenderer = this.cellRenderer.bind(this)
        this.getRowHeight = this.getRowHeight.bind(this)
        this.handleResize = this.handleResize.bind(this)
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
        this.handleResize();
        window.addEventListener("resize", this.handleResize.bind(this));
    }
    componentWillUnmount() {
        window.removeEventListener("resize",this.handleResize.bind(this))
    }

    scrollSpeedHandler = new ScrollSpeed();

    handleScroll = ({scrollTop}) => {
        // scrollSpeed represents the number of pixels scrolled since the last scroll event was fired
        const scrollSpeed = Math.abs(this.scrollSpeedHandler.getScrollSpeed(scrollTop));

        if (scrollSpeed >= SPEED_THRESHOLD) {
          this.setState({
            isScrollingFast: true,
            scrollTop:scrollTop
          });
        }

        // Since this method is debounced, it will only fire once scrolling has stopped for the duration of SCROLL_DEBOUNCE_DURATION
        this.handleScrollEnd();
    }

    handleScrollEnd = debounce(() => {
    const {isScrollingFast} = this.state;

    if (isScrollingFast) {
      this.setState({
        isScrollingFast: false,
      });
    }
    }, SCROLL_DEBOUNCE_DURATION);



    handleResize() {
        var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 10
        const {entrySquareSize,numEntrySquaresPerRow} = calculateGridCellSize(columnWidth)
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
            if (this.state.isScrollingFast) {
                return (
                    <div key={key} style={{...style,
                        width:this.state.entrySquareSize-2,
                        height:this.state.entrySquareSize-2,
                        backgroundColor:'#eeeeee'}}>
                    </div>          
                )
            }

        	if (this.props.noTimestampPhotos[photoResIdx].image_hash.length > 0) {
	            return (
                    <div key={key} style={style}>
                        <Image key={'daygroup_image_'+this.props.noTimestampPhotos[photoResIdx].image_hash} style={{display:'inline-block',padding:1,margin:0}}
                            onClick={()=>{
                                this.onPhotoClick(photoResIdx)
                            }}
                            height={this.state.entrySquareSize} 
                            width={this.state.entrySquareSize} 
                            src={serverAddress+'/media/square_thumbnails/'+this.props.noTimestampPhotos[photoResIdx].image_hash+'.jpg'}/>
                    </div>         
	            )
        	} else {
	            return (
                    <div key={key} style={{...style,
                        padding:1,
                        width:this.state.entrySquareSize-2,
                        height:this.state.entrySquareSize-2,
                        backgroundColor:'#eeeeee'}}>
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
                      style={{outline:'none'}}
                      onScroll={this.handleScroll}
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
*/

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


