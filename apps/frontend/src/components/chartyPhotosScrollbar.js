import React, { Component } from 'react'
import { XYPlot, makeHeightFlexible } from 'react-vis';
import { Chart, Transform, Bars } from 'rumble-charts'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import Month from 'calendar-months';


/*
{
  x: el.value.x,
  y: el.value.y,
  size: el.value.size,
  name: el.person_name,
}
*/

const FlexibleScroll = makeHeightFlexible(XYPlot)

export class ChartyPhotosScrollbar extends Component {
  constructor(props) {
    super(props)
    this.preprocessData = this.preprocessData.bind(this)
  }

  componentWillMount() {
/*
    this.props.dispatch(fetchDateAlbumsList())
*/
  }

  preprocessData() {
    var firstEvent = this.props.albumsDateList[this.props.albumsDateList.length-1]
    var lastEvent = this.props.albumsDateList[0]
    var firstYear = firstEvent.date.split('-')[0]
    var firstMonth = firstEvent.date.split('-')[1]
    var lastYear = lastEvent.date.split('-')[0]
    var lastMonth = lastEvent.date.split('-')[1]

    var beginning = new Month(firstMonth, firstYear)
    var end = new Month(lastMonth, lastYear)


    var currentMonth = beginning.lastMonth()

    var dataPhotoCounts = []
    var xAxisLabels = []
    var xTickValues = []

    var idx = 0
    while (!currentMonth.lastMonth().isThisMonth()) {
      currentMonth = currentMonth.nextMonth()
      var y = currentMonth.year.toString()
      var m = currentMonth.month.toString()

      if (m.length==1){
        m = '0'+m
      }

      //photo counts
      var thisMonthDateAlbums = this.props.albumsDateList.filter(function(album){
        var albumYear = album.date.split('-')[0]
        var albumMonth = album.date.split('-')[1]
        if (albumYear==y && albumMonth==m){
          return true}
        else {
          return false}
      })

      var thisMonthPhotoCounts = thisMonthDateAlbums.map(function(album){
        return album.photo_count
      })

      var thisMonthTotalPhotoCount = 0
      for (var i in thisMonthPhotoCounts) {
        thisMonthTotalPhotoCount += thisMonthPhotoCounts[i]
      }



      var datumPhotoCounts = {
        y: idx,
        x: thisMonthTotalPhotoCount,
        month: y+m
      }




      if (m=='01') {
        var xAxisLabel = y+'-'+m
        xTickValues.push(idx)
      }
      else {
        var xAxisLabel = m
        if (m=='03'||m=='06'||m=='09'){
          xTickValues.push(idx)
        }
      }


      xAxisLabels.push(xAxisLabel)
      dataPhotoCounts.push(datumPhotoCounts)
      idx += 1
    }

    return (
      {
        markerSeriesPhotoCount:dataPhotoCounts,
        xAxisLabels:xAxisLabels,
        xTickValues: xTickValues
      }
    )
  }

  render() {
    if (this.props.fetchedAlbumsDateList){
      try {      
        var preprocessed = this.preprocessData()
      }
      catch (err) {
        var preprocessed = {
          markerSeriesPhotoCount:[],
          xAxisLabels:[],
          xTickValues:[]
        }
      }
    }
    else {
      var preprocessed = {
        markerSeriesPhotoCount:[],
        xAxisLabels:[],
        xTickValues:[]
      }
    }
    var reversed = preprocessed.markerSeriesPhotoCount.reverse()

    console.log(series)
    console.log(reversed)

    var data = reversed.map(function(datum){
      return datum.x
    })

    var series = [{data:[0,1,2,3,4]}]

    return (
      <Chart width={30} height={500} series={series}>
        <Transform method={['rotate']}>
          <Bars innerPadding='0%' colors={['#666666']}
            barStyle={{fillOpacity:0.8}}
            barAttributes={{
              onMouseMove: e => e.target.style.fillOpacity = 1,
              onMouseLeave: e => e.target.style.fillOpacity = 0.8,
              onClick: (e,d) => console.log(e,d)
            }}/>

        </Transform>
      </Chart>    
    )

  }
}



ChartyPhotosScrollbar = connect((store)=>{
  return {
    albumsDateList: store.albums.albumsDateList,
    fetchingAlbumsDateList: store.albums.fetchingAlbumsDateList,
    fetchedAlbumsDateList: store.albums.fetchedAlbumsDateList,
  }
})(ChartyPhotosScrollbar)

export default Dimensions()(ChartyPhotosScrollbar)