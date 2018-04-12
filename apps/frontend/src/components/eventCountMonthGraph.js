import React, {Component} from 'react'
import {Grid, Segment, Header} from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import {fetchDateAlbumsList, fetchAutoAlbumsList} from '../actions/albumsActions'
import {fetchPhotoMonthCounts} from '../actions/utilActions'

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
  }

  componentWillMount() {
    this.props.dispatch(fetchPhotoMonthCounts())
  }


  render() {
    if (this.props.fetchedPhotoMonthCounts) {
      var countDict = this.props.photoMonthCounts
      var series = countDict.map(function(el){
        return {y:el.count,month:el.month}
      })
      var xticks = countDict.map(function(el){
        return el.month
      })
      console.log(xticks)
    }
    else {
      var series = []
    }

    var data = [{
      data: series
    }, {
      data: [0,1,2]
    }]

    return (
      <Segment>
        <div>
          <Header as='h3'>Photo Counts by Month</Header>
          <div>
            <Chart width={this.props.containerWidth-50} height={250} series={[data[0]]}>
              <Layer width='90%' height='85%' position='middle center'>
                <Ticks
                  axis='y'
                  lineLength='100%'
                  lineVisible={true}
                  lineStyle={{stroke:'lightgray'}}
                  labelStyle={{textAnchor:'end',dominantBaseline:'middle',fill:'grey'}}
                  labelAttributes={{x: -15}}
                  labelFormat={label => label}/>
                <Ticks
                  lineVisible={true}
                  lineLength='100%'
                  axis='x'
                  labelFormat={label => xticks[label]}
                  labelStyle={{textAnchor:'middle',dominantBaseline:'text-before-edge',fill:'black'}}
                  labelAttributes={{y: 5}}/>
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
    photoMonthCounts: store.util.photoMonthCounts,
    fetchingPhotoMonthCounts: store.util.fetchingPhotoMonthCounts,
    fetchedPhotoMonthCounts: store.util.fetchedPhotoMonthCounts,
  }
})(EventCountMonthGraph)


export default Dimensions()(EventCountMonthGraph)