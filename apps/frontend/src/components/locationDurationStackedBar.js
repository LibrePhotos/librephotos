import React, { Component } from 'react'
import { Label, Segment, Header, Loader } from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { fetchLocationTimeline } from '../actions/utilActions'
import moment from 'moment'
import { Hint, XYPlot, XAxis, HorizontalBarSeries } from 'react-vis'


/*
{
  x: el.value.x,
  y: el.value.y,
  size: el.value.size,
  name: el.person_name,
}
*/

export class LocationDurationStackedBar extends Component {
  state = {hintValue:null}

  componentWillMount() {
    if (!this.props.fetchedLocationTimeline){
      this.props.dispatch(fetchLocationTimeline())
    }
  }


  render() {
    if (this.props.fetchedLocationTimeline){
      return (
          <div style={{height:280}}>
            <Header as='h3'>Location Timeline</Header>
            <div>


              <XYPlot
                width={this.props.containerWidth-30}
                height={300}
                stackBy="x">
                <XAxis tickFormat={v=> {
                    return(moment.unix(this.props.locationTimeline[0].start+ v).format('YYYY-MM'))
                }}/>

                {this.props.locationTimeline.map((el)=>
                  <HorizontalBarSeries
                    onValueMouseOver={(d,info)=>{
                        this.setState({hintValue:d})
                    }}
                    style={{fill:el.color,stroke:el.color}}
                    data={[{
                        y:1,
                        x:el.data[0],
                        loc:el.loc,
                        start:el.start,
                        end:el.end
                    }]}/>
                )}
                
                { this.state.hintValue && (
                    <Hint value={this.state.hintValue}>
                            <Label color='black'>
                                {this.state.hintValue.loc}
                                {' from ' + moment.unix(this.state.hintValue.start).format('YYYY-MM-DD') + 
                                 ' to ' + moment.unix(this.state.hintValue.end).format('YYYY-MM-DD')}
                            </Label>
                    </Hint>
                )} 


              </XYPlot>


            </div>
          </div>
      )
    } else {
      return (
        <div style={{height:280}}>
        <Header as='h3'>Location Timeline</Header>
        <Segment style={{height:250}} basic>
        <Loader active/>
        </Segment>
        </div>
      )
    }
  }
}

LocationDurationStackedBar = connect((store)=>{
  return {
    locationTimeline: store.util.locationTimeline,
    fetchingLocationTimeline: store.util.fetchingLocationTimeline,
    fetchedLocationTimeline: store.util.fetchedLocationTimeline,
  }
})(LocationDurationStackedBar)


export default Dimensions()(LocationDurationStackedBar)


// <Chart width={this.props.containerWidth} height={250} series={this.props.locationTimeline}>
//   <Layer width='80%' height='85%' position='middle center'>
//     <Transform method={['stack', 'rotate']}>
//       <Bars combined={true} innerPadding='2%' />
//     </Transform>
//   </Layer>
// </Chart>
