import React, { Component } from 'react'
import { Segment, Header, Loader } from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { fetchPhotoCountryCounts } from '../../actions/utilActions'
import { Chart, Pies, Transform } from 'rumble-charts'


export class CountryPiChart extends Component {
  constructor(props) {
    super(props)
  }
  componentDidMount() {
    if (!this.props.fetchedPhotoCountryCounts)
    {
      this.props.dispatch(fetchPhotoCountryCounts())
    }
  }
  render(){
    if (this.props.fetchedPhotoCountryCounts) {
      var countDict = this.props.photoCountryCounts
      var counts = Object.keys(countDict).map(function(key){
        return countDict[key]
      })
      if (counts.length === 0){counts = [1]}
      console.log(counts)
      var series = [{data:counts}]
      var map = (
        <div>
          <Header as='h3'>Photo Counts by Location</Header>
            <Chart 
              width={this.props.containerWidth-50}
              height={200}
              series={series}>
              <Transform method={['transpose','stack']}>
                <Pies combined={true}/>
              </Transform>
            </Chart>
        </div>
      )
    }
    else {
      var h = 200
      var w = `${this.props.containerWidth-50}px`
      var map = (
        <div>
          <Header as='h3'>Photo Counts by Location</Header>
            <div style={{height:h, width:w}}>
            <Loader active/>
            </div>
        </div>
      )
    }
    return (
      <Segment style={{zIndex:2, height:300}}>
        {map}
      </Segment>
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