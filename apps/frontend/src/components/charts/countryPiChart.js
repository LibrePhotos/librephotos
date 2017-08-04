import React, {Component} from 'react'
import {Segment, Header} from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import {fetchPhotoCountryCounts} from '../../actions/utilActions'

import Month from 'calendar-months';
import {Chart, Bars, Lines, Ticks, Layer, Pies, Transform} from 'rumble-charts'


export class CountryPiChart extends Component {
  constructor(props) {
    super(props)
  }

  componentDidMount() {
    this.props.dispatch(fetchPhotoCountryCounts())
  }



  render(){
    if (this.props.fetchedPhotoCountryCounts) {
      var countDict = this.props.photoCountryCounts
      var counts = Object.keys(countDict).map(function(key){
        return countDict[key]
      })
      if (counts.length == 0){counts = [1]}
      console.log(counts)
      var series = [{data:counts}]
      var map = (
        <Segment>
          <Header as='h3'>Photos by Country</Header>
            <Chart 
              width={this.props.containerWidth-50}
              height={250}
              series={series}>
              <Transform method={['transpose','stack']}>
                <Pies combined={true}/>
              </Transform>
            </Chart>
        </Segment>
      )
    }
    else {
      var h = `250px`
      var w = `${this.props.containerWidth-50}px`
      var map = (
        <Segment>
          <Header as='h3'># Photos by Country</Header>
            <div style={{height:h, width:w}}></div>
        </Segment>
      )
    }
    return (
      <div>
        {map}
      </div>
    )
  }
}

CountryPiChart = connect((store)=>{
  return {
    photoCountryCounts: store.util.photoCountryCounts,
    fetchingPhotoCountryCounts: store.util.fetchingPhotoCountryCounts,
    fetchedPhotoCountryCounts: store.util.fetchedPhotoCountryCounts,
  }
})(CountryPiChart)


export default Dimensions()(CountryPiChart)