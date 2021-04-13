import React, { Component } from 'react'
import { Loader, Segment, Header } from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { fetchPhotoMonthCounts } from '../actions/utilActions'
import { Chart, Bars, Ticks, Layer } from 'rumble-charts'

export class EventCountMonthGraph extends Component {

  componentWillMount() {
    if (!this.props.fetchedPhotoMonthCounts){
      this.props.dispatch(fetchPhotoMonthCounts())
    }
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
      return (
        <div style={{height:280}}>
        <Header as='h3'>Monthly Photo Counts</Header>
        <Segment style={{height:250}} basic>
        <Loader active/>
        </Segment>
        </div>
      )
    }

    var data = [{
      data: series
    }, {
      data: [0,1,2]
    }]

    return (
        <div style={{height:280}}>
          <Header as='h3'>Monthly Photo Counts</Header>
          <div>
            <Chart width={this.props.containerWidth} height={250} series={[data[0]]}>
              <Layer width='85%' height='85%' position='middle center'>
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
