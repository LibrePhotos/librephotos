import React, {Component} from 'react'
import {Segment, Header} from 'semantic-ui-react'
import {XYPlot, XAxis, YAxis, HorizontalGridLines, 
				MarkSeries, VerticalGridLines, Crosshair} from 'react-vis';
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { Graph } from 'react-d3-graph';
import { fetchSocialGraph } from '../actions/peopleActions'


export class SocialGraph extends Component {
	componentWillMount() {
		this.props.dispatch(fetchSocialGraph())
	}




	render(){
		var width = this.props.containerWidth-10

		console.log('social graph width',width)
		var data = this.props.socialGraph
		var myConfig = {
			automaticRearrangeAfterDropNode: false,
			staticGraph:false,
		    highlightBehavior: true,
		    maxZoom: 4,
		    minZoom: 1,
		    node: {
		        color: 'lightblue',
		        size: 120,
		        highlightStrokeColor: 'orange'
		    },
		    link: {
		        highlightColor: 'orange',
		        color: '#12939A',
		    },
		    height: 300,
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
				<Header as='h4'>Social Graph Based on Face Co-occurrence</Header>
				{graph}
			</div>
		)
	}
}




SocialGraph = connect((store)=>{
  return {
    socialGraph: store.people.socialGraph,
    fetching: store.people.fetchingSocialGraph,
    fetched: store.people.fetchedSocialGraph,
  }
})(SocialGraph)

export default Dimensions()(SocialGraph)