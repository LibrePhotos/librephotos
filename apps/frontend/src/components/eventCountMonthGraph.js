import React, {Component} from 'react'
import {Grid, Segment, Header} from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { Graph } from 'react-d3-graph';
import {fetchDateAlbumsList, fetchAutoAlbumsList} from '../actions/albumsActions'

import Month from 'calendar-months';
import {Chart, Bars, Lines, Ticks, Layer} from 'rumble-charts'


/*
{
  x: el.value.x,
  y: el.value.y,
  size: el.value.size,
  name: el.person_name,
}
*/

export class EventCountMonthGraph extends Component {
  constructor(props) {
    super(props)
    this.preprocessData = this.preprocessData.bind(this)
    this.preprocessDataRumble = this.preprocessDataRumble.bind(this)
  }

  componentWillMount() {
    this.props.dispatch(fetchDateAlbumsList())
    this.props.dispatch(fetchAutoAlbumsList())
  }

  preprocessData() {
    var firstEvent = this.props.albumsDateList[this.props.albumsDateList.length-1]
    var lastEvent = this.props.albumsDateList[0]
    var firstYear = firstEvent.date.split('-')[0]
    var firstMonth = firstEvent.date.split('-')[1]
    var lastYear = lastEvent.date.split('-')[0]
    var lastMonth = lastEvent.date.split('-')[1]

    console.log(lastYear,lastMonth)
    console.log(firstYear,firstMonth)

    if (lastMonth.startsWith('0')) {lastMonth = lastMonth[1]}
    if (firstMonth.startsWith('0')) {firstMonth = firstMonth[1]}

    lastMonth = parseInt(lastMonth) - 1
    firstMonth = parseInt(firstMonth) - 1

    var beginning = new Month(firstMonth, firstYear)
    var end = new Month(lastMonth, lastYear)


    var currentMonth = beginning.lastMonth()

    var dataPhotoCounts = []
    var dataEventCounts = []
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




      //event counts
      var thisMonthAutoAlbums = this.props.albumsAutoList.filter(function(album){
        var albumYear = album.timestamp.split('T')[0].split('-')[0]
        var albumMonth = album.timestamp.split('T')[0].split('-')[1]
        if (albumYear==y && albumMonth==m){
          return true}
        else {
          return false}
      })




      var datumPhotoCounts = {
        x: idx,
        y: thisMonthTotalPhotoCount,
        month: y+m
      }


      var datumEventCounts = {
        x: idx,
        y: thisMonthAutoAlbums.length,
        month: y+m
      }

      if (m=='01') {
        var xAxisLabel = y+'-'+m
        xTickValues.push(idx)
      }
      // else {
      //   var xAxisLabel = m
      //   if (m=='03'||m=='06'||m=='09'){
      //     xTickValues.push(idx)
      //   }
      // }


      xAxisLabels.push(xAxisLabel)
      dataPhotoCounts.push(datumPhotoCounts)
      dataEventCounts.push(datumEventCounts)
      idx += 1
    }

    return (
      {
        markerSeriesPhotoCount:dataPhotoCounts,
        markerSeriesEventCount:dataEventCounts,
        xAxisLabels:xAxisLabels,
        xTickValues: xTickValues
      }
    )
  }




  preprocessDataRumble() {
    var firstEvent = this.props.albumsDateList[this.props.albumsDateList.length-1]
    var lastEvent = this.props.albumsDateList[0]
    var firstYear = firstEvent.date.split('-')[0]
    var firstMonth = firstEvent.date.split('-')[1]
    var lastYear = lastEvent.date.split('-')[0]
    var lastMonth = lastEvent.date.split('-')[1]

    console.log(lastYear,lastMonth)
    console.log(firstYear,firstMonth)

    if (lastMonth.startsWith('0')) {lastMonth = lastMonth[1]}
    if (firstMonth.startsWith('0')) {firstMonth = firstMonth[1]}

    lastMonth = parseInt(lastMonth) - 1
    firstMonth = parseInt(firstMonth) - 1

    var beginning = new Month(firstMonth, firstYear)
    var end = new Month(lastMonth, lastYear)


    var currentMonth = beginning.lastMonth()

    var dataPhotoCounts = []
    var dataEventCounts = []
    var xAxisLabels = []
    var xTickValues = []

    var idx = 0
    while (!currentMonth.lastMonth().isThisMonth()) {
      currentMonth = currentMonth.nextMonth()
      var y = currentMonth.year.toString()
      var m = (currentMonth.month+1).toString()

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




      //event counts
      var thisMonthAutoAlbums = this.props.albumsAutoList.filter(function(album){
        var albumYear = album.timestamp.split('T')[0].split('-')[0]
        var albumMonth = album.timestamp.split('T')[0].split('-')[1]
        if (albumYear==y && albumMonth==m){
          return true}
        else {
          return false}
      })




      var datumPhotoCounts = thisMonthTotalPhotoCount

      var datumEventCounts = thisMonthAutoAlbums.length

      if (m=='01') {
        var xAxisLabel = y+'-'+m
        xTickValues.push(idx)
      }
      // else {
      //   var xAxisLabel = m
      //   if (m=='03'||m=='06'||m=='09'){
      //     xTickValues.push(idx)
      //   }
      // }


      xAxisLabels.push(xAxisLabel)
      dataPhotoCounts.push(datumPhotoCounts)
      dataEventCounts.push(datumEventCounts)
      idx += 1
    }

    return (
      {
        markerSeriesPhotoCount:dataPhotoCounts,
        markerSeriesEventCount:dataEventCounts,
        xAxisLabels:xAxisLabels,
        xTickValues: xTickValues
      }
    )
  }




  render() {
    if (this.props.fetchedAlbumsDateList && this.props.fetchedAlbumsDateList){
      try {      
        var preprocessed = this.preprocessDataRumble()
        var series = [preprocessed.markerSeriesPhotoCount,preprocessed.markerSeriesEventCount]
      }
      catch (err) {
        console.log(err)
        var preprocessed = {
          markerSeriesPhotoCount:[],
          markerSeriesEventCount:[],
          xAxisLabels:[],
          xTickValues:[]
        }
        var series = []
      }
    }
    else {
      var preprocessed = {
        markerSeriesPhotoCount:[],
        markerSeriesEventCount:[],
        xAxisLabels:[],
        xTickValues:[]
      }
      var series = []
    }
    console.log(preprocessed)

    var data = [{
      data: preprocessed.markerSeriesPhotoCount
    }, {
      data: preprocessed.markerSeriesEventCount
    }]

    return (
      <Segment>
        <div>
          <Header as='h3'># Photos by Month</Header>

          <div>


          <Chart width={this.props.containerWidth-50} height={250} series={[data[0]]}>
            <Layer width='90%' height='95%' position='top right'>
              <Ticks
                axis='y'
                lineLength='100%'
                lineVisible={true}
                lineStyle={{stroke:'lightgray'}}
                labelStyle={{textAnchor:'end',dominantBaseline:'middle',fill:'lightgray'}}
                labelAttributes={{x: -5}}
                labelFormat={label => label}/>
              <Bars />
            </Layer>
          </Chart>
          </div>
        </div>
      </Segment>
    )
  }
}



EventCountMonthGraph = connect((store)=>{
  return {
    albumsDateList: store.albums.albumsDateList,
    fetchingAlbumsDateList: store.albums.fetchingAlbumsDateList,
    fetchedAlbumsDateList: store.albums.fetchedAlbumsDateList,

    albumsAutoList: store.albums.albumsAutoList,
    fetchingAlbumsAutoList: store.albums.fetchingAlbumsAutoList,
    fetchedAlbumsAutoList: store.albums.fetchedAlbumsAutoList,

  }
})(EventCountMonthGraph)


export default Dimensions()(EventCountMonthGraph)