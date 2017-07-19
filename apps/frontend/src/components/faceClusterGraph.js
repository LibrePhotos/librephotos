import React, {Component} from 'react'
import {Segment, Header} from 'semantic-ui-react'
import {XYPlot, XAxis, YAxis, HorizontalGridLines, 
				MarkSeries, VerticalGridLines, Crosshair} from 'react-vis';
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { Graph } from 'react-d3-graph';
import { fetchSocialGraph } from '../actions/peopleActions'

export class FaceClusterScatter extends Component {
  constructor(props) {
    super(props)
    this.state = {
      crosshairValues: []
    };
  }

	render() {
    var person_names = [... new Set(this.props.facesVis.map(function(el){return el.person_name}))]
    var facesVis = this.props.facesVis

    var mappedScatter = person_names.map(function(person_name,idx){
    	var thisPersonVis = facesVis.filter(function(el){
    		return (person_name===el.person_name)
    	})
    	var thisPersonData = thisPersonVis.map(function(el){
				return (
					{
						x: el.value.x,
						y: el.value.y,
						size: el.value.size,
						name: el.person_name,
					}
				)
    	})
    	return (<MarkSeries key={"cluster-marker-"+idx} animation data={thisPersonData}/>)
    })
		return (
			<Segment>
				<Header as='h3'>Face Embeddings</Header>
	    	<XYPlot
				  width={this.props.containerWidth-50}
				  height={203}>
				  <HorizontalGridLines/>
					<VerticalGridLines/>
					<XAxis/>
					<YAxis/>
				  {mappedScatter}

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