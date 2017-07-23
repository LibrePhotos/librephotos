import React, {Component} from 'react'
import {Segment, Header} from 'semantic-ui-react'
import {XYPlot, XAxis, YAxis, HorizontalGridLines, LineMarkSeries, LineSeries,
        MarkSeries, VerticalGridLines, Crosshair, DiscreteColorLegend} from 'react-vis';
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { Graph } from 'react-d3-graph';
import {fetchDateAlbumsList, fetchAutoAlbumsList} from '../actions/albumsActions'

import Month from 'calendar-months';


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
      else {
        var xAxisLabel = m
        if (m=='03'||m=='06'||m=='09'){
          xTickValues.push(idx)
        }
      }


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
        var preprocessed = this.preprocessData()
        var series = [preprocessed.markerSeriesPhotoCount,preprocessed.markerSeriesEventCount]
      }
      catch (err) {
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
    return (
      <Segment>
        <div>
          <Header as='h3'>Photo & Event Counts</Header>
          <div>
            <DiscreteColorLegend 
              orientation='horizontal'
              items={[{title:'photos'},{title:'events'}]}/>
          </div>
          <div>
          <XYPlot
            width={this.props.containerWidth-50}
            height={203}>
            <HorizontalGridLines/>
            <VerticalGridLines/>
            <XAxis 
              tickValues = {preprocessed.xTickValues}
              tickFormat={t => preprocessed.xAxisLabels[t]} 
              tickLabelAngle={-40}/>
            <YAxis />
            <LineSeries data={preprocessed.markerSeriesPhotoCount}/>
            <LineSeries data={preprocessed.markerSeriesEventCount}/>
          </XYPlot>
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