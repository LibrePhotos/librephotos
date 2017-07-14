import React, {Component} from 'react'
import {Segment} from 'semantic-ui-react'
import {XYPlot, XAxis, YAxis, HorizontalGridLines, 
				MarkSeries, VerticalGridLines, Crosshair} from 'react-vis';
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";

export class FaceClusterScatter extends Component {
  constructor(props) {
    super(props)
    this.state = {
      crosshairValues: []
    };
  }

	render() {
		var data = this.props.facesVis.map(function(el,idx){
			return (
				{
					x: el.value.x,
					y: el.value.y,
					color: el.person_id,
					size: el.value.size,
					name: el.person_name
				}
			)
		})
		console.log(this.state.crosshairValues)
		return (
			<Segment>
	    	<XYPlot
				  width={this.props.containerWidth-50}
				  height={237}>
				  <HorizontalGridLines/>
					<VerticalGridLines/>
					<XAxis/>
					<YAxis/>
				  <MarkSeries
				  	onMouseLeave={() => this.setState({crosshairValues: []})}
          	onNearestXY={(value, {index}) =>
              this.setState({crosshairValues: [data[index]]})}
				  	stroke='white'
				    data={data}/>
				  <Crosshair values={this.state.crosshairValues}>
				  	<div>
				  	</div>
				  </Crosshair>
				</XYPlot>
			</Segment>
		)
	}
}


FaceClusterScatter = connect((store)=>{
  return {
    facesVis: store.faces.facesVis,
    training: store.faces.training,
    trained: store.faces.trained,
  }
})(FaceClusterScatter)

export default Dimensions()(FaceClusterScatter)