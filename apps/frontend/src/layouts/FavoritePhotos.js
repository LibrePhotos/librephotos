
import React, { Component } from 'react';
import { connect } from "react-redux";
import { fetchFavoritePhotos } from '../actions/photosActions';
import moment from 'moment'
import _ from 'lodash'
import { PhotoListView } from './ReusablePhotoListView'


var topMenuHeight = 55 // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;
var DAY_HEADER_HEIGHT = 70
var leftMenuWidth = 85 // don't change this

var SIDEBAR_WIDTH = 85;

export class FavoritePhotos extends Component {
  state = {
    photosGroupedByDate: [],
    idx2hash: [],
  }

  componentDidMount() {
    this.props.dispatch(fetchFavoritePhotos())
  }



  static getDerivedStateFromProps(nextProps,prevState){
      const photos = nextProps.favoritePhotos
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
          return {
              ...prevState, 
              photosGroupedByDate: groupedByDateList,
              idx2hash:idx2hash,
          }
      } else {
        return null
      }
  }



  render() {
    const {favoritePhotos,fetchingFavoritePhotos,fetchedFavoritePhotos} = this.props
    return (
      <PhotoListView 
        showHidden={false}
        title={"Favorite Photos"}
        loading={fetchingFavoritePhotos}
        titleIconName={'star'}
        photosGroupedByDate={this.state.photosGroupedByDate}
        idx2hash={this.state.idx2hash}
      />
    )  
  }
}

/*
export class AlbumPersonGallery extends Component {

  constructor() {
    super();
    this.listRef = React.createRef()
    this.handleResize = this.handleResize.bind(this)
    this.cellRenderer = this.cellRenderer.bind(this)
    this.onPhotoClick = this.onPhotoClick.bind(this)
    this.state = {
        photosGroupedByDate: [],
        cellContents: [[]],
        hash2row: {},
        idx2hash: [],
        lightboxImageIndex: 1,
        lightboxShow:false,
        lightboxSidebarShow:false,
        scrollToIndex: undefined,
        width:  window.innerWidth,
        height: window.innerHeight,
        entrySquareSize:200,
        numEntrySquaresPerRow:3,
        currTopRenderedRowIdx:0,
        scrollTop:0,
        gridHeight: window.innerHeight- topMenuHeight - 60,
        showGraph:false,
    }
  }


  scrollSpeedHandler = new ScrollSpeed()

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




  componentDidMount() {
    this.handleResize();
    window.addEventListener("resize", this.handleResize.bind(this));
    if (this.props.people.length == 0){
      this.props.dispatch(fetchPeopleAlbums(this.props.match.params.albumID))
    }
    this.props.dispatch(fetchEgoGraph(this.props.match.params.albumID))
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize.bind(this))
  }


  handleResize() {
    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 10
    const {entrySquareSize,numEntrySquaresPerRow} = calculateGridCellSize(columnWidth)
    var {cellContents,hash2row} = calculateGridCells(this.state.photosGroupedByDate,numEntrySquaresPerRow)

    this.setState({
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:entrySquareSize,
      numEntrySquaresPerRow:numEntrySquaresPerRow,
      cellContents: cellContents,
      hash2row: hash2row
    })
    if (this.listRef.current) {
        this.listRef.current.recomputeGridSize()
    }
  }

    onPhotoClick(hash) {
        this.setState({lightboxImageIndex:this.state.idx2hash.indexOf(hash),lightboxShow:true})
    }

 



    static getDerivedStateFromProps(nextProps,prevState){
      if (nextProps.albumsPeople.hasOwnProperty(nextProps.match.params.albumID)){
        const photos = nextProps.albumsPeople[nextProps.match.params.albumID].photos
        if (prevState.idx2hash.length != photos.length) {

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

            
            var {cellContents,hash2row} = calculateGridCells(groupedByDateList,prevState.numEntrySquaresPerRow)
            console.log(cellContents)
            var t1 = performance.now();
            console.log(t1-t0)
            return {
                ...prevState, 
                photosGroupedByDate: groupedByDateList,
                idx2hash:idx2hash,
                cellContents: cellContents,
                hash2row:hash2row
            }
        } else {
          return null
        }
      } else {
        return null
      }
    }



    cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
        if (this.state.cellContents[rowIndex][columnIndex]) { // non-empty cell
            const cell = this.state.cellContents[rowIndex][columnIndex]
            if (cell.date) { // header cell has 'date' attribute
                return ( 
                    <div key={key} style={{...style,width:this.state.width,height:DAY_HEADER_HEIGHT,paddingTop:20}}>
                        <div style={{backgroundColor:'white'}}>
                            <Header as='h3'>
                                <Icon name='calendar outline'/>
                                <Header.Content>
                                    { cell.date=='No Timestamp' ? "No Timestamp" : moment(cell.date).format("MMM Do YYYY, dddd")}
                                    <Header.Subheader>
                                        <Icon name='photo'/>{cell.photos.length} Photos
                                    </Header.Subheader>
                                </Header.Content>
                            </Header>
                        </div>
                    </div>                
                )   
                
                // if (!this.state.isScrollingFast){
                // } else {
                //     return (
                //         <div key={key} style={{
                //             ...style,
                //             backgroundColor:'#dddddd',
                //             width:250,
                //             marginTop:2,
                //             height:DAY_HEADER_HEIGHT-4,
                //             paddingTop:10}}>
                //         </div>                
                //     )        
                // } 
                
            } else { // photo cell doesn't have 'date' attribute
                if (!this.state.isScrollingFast) {
                    return (
                        <div key={key} style={style}>
                            <Image key={'daygroup_image_'+cell.image_hash} style={{display:'inline-block',padding:1,margin:0}}
                                onClick={()=>{
                                    this.onPhotoClick(cell.image_hash)
                                }}
                                height={this.state.entrySquareSize} 
                                width={this.state.entrySquareSize} 
                                src={serverAddress+'/media/square_thumbnails/'+cell.image_hash+'.jpg'}/>
                        </div>                                
                    )
                } else {
                    return (
                        <div key={key} style={{...style,
                            width:this.state.entrySquareSize-2,
                            height:this.state.entrySquareSize-2,
                            backgroundColor:'#eeeeee'}}>
                        </div>                                
                    )
                }

            }

        } else { // empty cell
            return (
                <div key={key} style={style}>
                </div>
            )
        }
    }


  
  getPhotoDetails(image_hash) {
      if (!this.props.photoDetails.hasOwnProperty(image_hash)) {
          this.props.dispatch(fetchPhotoDetail(image_hash))
      }
  }

  render() {
    if (this.props.albumsPeople.hasOwnProperty(this.props.match.params.albumID)) {
        var totalListHeight = this.state.cellContents.map((row,index)=>{
            if (row[0].date) { //header row
                return DAY_HEADER_HEIGHT
            } else { //photo row
                return this.state.entrySquareSize
            }
        }).reduce((a,b)=>(a+b),0)
	    return (
	      <div>

          <div style={{position:'fixed',top:topMenuHeight+22,right:5,float:'right'}}>

          </div>



	      	<div style={{height:this.state.headerHeight,paddingTop:10,paddingRight:5}}>


            <Header as='h2'>
              <Icon name='user circle' />
              <Header.Content>
                  {this.props.albumsPeople[this.props.match.params.albumID].name + " "}
                  <Button 
                    size='tiny'
                    compact
                    icon='share alternate'
                    active={this.state.showGraph}
                    circular
                    onClick={()=>{
                        this.setState({
                        showGraph: !this.state.showGraph,
                        gridHeight: !this.state.showGraph ? this.state.height - topMenuHeight - 260 : this.state.height - topMenuHeight - 60,
                        headerHeight: !this.state.showGraph ? 260 : 60
                        })}
                    }/>
                <Header.Subheader>
          	      {this.props.albumsPeople[this.props.match.params.albumID].photos.length} Photos
                </Header.Subheader>
              </Header.Content>
            </Header>


            {this.state.showGraph && <EgoGraph height={200-20} width={this.state.width-SIDEBAR_WIDTH-12 } person_id={this.props.match.params.albumID}/>}


	      	</div>


                <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0}}>
                  {({width}) => (
                    <Grid
                      ref={this.listRef}
                      onSectionRendered={({rowStartIndex})=>{
                        var date = this.state.cellContents[rowStartIndex][0].date
                        if (date) {
                            if (date=='No Timestamp') {
                                this.setState({
                                    currTopRenderedRowIdx:rowStartIndex,
                                    date:date,
                                    fromNow:date
                                })
                            } else {
                                this.setState({
                                    currTopRenderedRowIdx:rowStartIndex,
                                    date:moment(date).format("MMMM Do YYYY"),
                                    fromNow:moment(date).fromNow()
                                })
                            }
                        }
                      }}
                      overscanRowCount={5}
                      style={{outline:'none'}}
                      cellRenderer={this.cellRenderer}
                      onScroll={this.handleScroll}
                      columnWidth={this.state.entrySquareSize}
                      columnCount={this.state.numEntrySquaresPerRow}
                      height={this.state.height- topMenuHeight - 60}
                      estimatedRowSize={totalListHeight/this.state.cellContents.length.toFixed(1)}
                      rowHeight={({index})=> {
                        if (this.state.cellContents[index][0].date) { //header row
                            return DAY_HEADER_HEIGHT
                        } else { //photo row
                            return this.state.entrySquareSize
                        }
                      }}
                      rowCount={this.state.cellContents.length}
                      width={width}
                    />
                  )}
                </AutoSizer>

            { this.state.cellContents[this.state.currTopRenderedRowIdx][0] && (
                <div style={{
                    right:0,
                    top:topMenuHeight + 10+ (0 / totalListHeight) * (this.state.height - topMenuHeight - 50 - 20),
                    position:'fixed',
                    float:'left',
                    width:180,
                    padding:0,
                    height:50,
                    zIndex:100,
                }}>
                    <div style={{textAlign:'right',paddingRight:30}} className='handle'>
                        <b>{this.state.date}</b> <br/>
                    </div>
                    <div style={{textAlign:'right',paddingRight:30}}>
                        {this.state.fromNow}
                    </div>
                </div>
            )}


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
                      var rowIdx = this.state.hash2row[this.state.idx2hash[nextIndex]]
                      this.listRef.current.scrollToCell({columnIndex:0,rowIndex:rowIdx})
                      this.getPhotoDetails(this.state.idx2hash[nextIndex])
                  }}
                  onMoveNextRequest={() => {
                      var nextIndex = (this.state.lightboxImageIndex + this.state.idx2hash.length + 1) % this.state.idx2hash.length
                      this.setState({
                          lightboxImageIndex:nextIndex
                      })
                      var rowIdx = this.state.hash2row[this.state.idx2hash[nextIndex]]
                      this.listRef.current.scrollToCell({columnIndex:0,rowIndex:rowIdx})
                      this.getPhotoDetails(this.state.idx2hash[nextIndex])
                  }}/>
          }

				</div>
	    )
    }
    else {
    	return (
    		<div><Loader active/></div>
    	)
    }
  }
}
*/

FavoritePhotos = connect((store)=>{
  return {
    favoritePhotos: store.photos.favoritePhotos,
    fetchingFavoritePhotos: store.photos.fetchingFavoritePhotos,
    fetchedFavoritePhotos: store.photos.fetchedFavoritePhotos,

    albumsPeople: store.albums.albumsPeople,
    fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
    fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
    people: store.people.people,
    fetchedPeople: store.people.fetched,
    fetchingPeople: store.people.fetching,
    photoDetails: store.photos.photoDetails,
    fetchingPhotoDetail: store.photos.fetchingPhotoDetail,
    fetchedPhotoDetail: store.photos.fetchedPhotoDetail,
  }
})(FavoritePhotos)
