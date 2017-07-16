import React, {Component} from 'react'
import {Segment, Header, Loader} from 'semantic-ui-react'
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
		var width = this.props.containerWidth-30

		console.log('social graph width',width)
		var data = this.props.socialGraph
		var myConfig = {
			automaticRearrangeAfterDropNode: true,
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
		    height: 250,
		    width: width
		}

		if (this.props.fetched) {
			var graph = <Graph id='social-graph'
					config={myConfig}
					data={this.props.socialGraph}/>
		}
		else {
			var graph = <Loader/>
		}

		console.log(this.props)
		return (
			<Segment>
        <Header as='h3'>Face Co-occurrence Based Social Graph</Header>
  			{graph}
			</Segment>
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