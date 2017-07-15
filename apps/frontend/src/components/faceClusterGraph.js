import React, {Component} from 'react'
import {Segment} from 'semantic-ui-react'
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

    var mappedScatter = person_names.map(function(person_name){
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
    	return (<MarkSeries animation data={thisPersonData}/>)
    })
		return (
			<Segment>
	    	<XYPlot
				  width={this.props.containerWidth-50}
				  height={237}>
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



export class SocialGraph extends Component {
	componentWillMount() {
		this.props.dispatch(fetchSocialGraph())
	}




	render(){
		var width = this.props.containerWidth
		console.log('social graph width',width)
		var data = this.props.socialGraph
		var myConfig = {
		    highlightBehavior: true,
		    node: {
		        color: 'lightgreen',
		        size: 120,
		        highlightStrokeColor: 'blue'
		    },
		    link: {
		        highlightColor: 'lightblue'
		    },
		    height: 200,
		    width: width
		}

		if (this.props.fetched) {
			var graph = <Graph id='social-graph'
					config={myConfig}
					data={this.props.socialGraph}/>
		}
		else {
			var graph = "No data!"
		}

		console.log(this.props)
		return (
			<div>
				{graph}
			</div>
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

SocialGraph = connect((store)=>{
  return {
    socialGraph: store.people.socialGraph,
    fetching: store.people.fetchingSocialGraph,
    fetched: store.people.fetchedSocialGraph,
  }
})(SocialGraph)

export default Dimensions()(FaceClusterScatter)