import React, {Component} from 'react'
import {Segment, Header} from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import {fetchWordCloud} from '../../actions/utilActions'

import Month from 'calendar-months';
import {Chart, Bars, Lines, Ticks, Layer, Pies, Transform, Cloud} from 'rumble-charts'


export class WordCloud extends Component {
  constructor(props) {
    super(props)
  }

  componentDidMount() {
    this.props.dispatch(fetchWordCloud())
  }



  render(){
    if (this.props.fetchedWordCloud) {
      var wordCloud = this.props.wordCloud
      if (this.props.type=='captions'){
        var series = [{data:wordCloud.captions}]
      }
      else {
        var series = [{data:wordCloud.locations}]        
      }
      var chart = (
        <Segment>
          <Header as='h3'>Photos by Country</Header>
            <Chart 
              width={this.props.containerWidth-50}
              height={250}
              series={series}>
              <Transform method={['transpose']}>
                <Cloud font='sans-serif' minFontsSize={10} maxFontSize={50}/>
              </Transform>
            </Chart>
        </Segment>
      )
    }
    else {
      var h = `250px`
      var w = `${this.props.containerWidth-50}px`
      var chart = (
        <Segment>
          <Header as='h3'># Photos by Country</Header>
            <div style={{height:h, width:w}}></div>
        </Segment>
      )
    }
    return (
      <div>
        {chart}
      </div>
    )
  }
}

WordCloud = connect((store)=>{
  return {
    wordCloud: store.util.wordCloud,
    fetchingWordCloud: store.util.fetchingWordCloud,
    fetchedWordCloud: store.util.fetchedWordCloud,
  }
})(WordCloud)


export default Dimensions()(WordCloud)