import React, { Component } from 'react'
import { Loader } from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { Graph } from 'react-d3-graph';
import { fetchSocialGraph } from '../actions/peopleActions'

export class SocialGraph extends Component {
	componentWillMount() {
		if (!this.props.fetched){
			this.props.dispatch(fetchSocialGraph())
		}
	}

	render(){
		var width = this.props.containerWidth

		console.log('social graph width',width)
		var myConfig = {
			automaticRearrangeAfterDropNode: false,
			staticGraph:true,
		    nodeHighlightBehavior: true,
		    maxZoom: 4,
		    minZoom: 0.1,
		    node: {
		    	fontSize: 10,
		    	size: 500,
		        color: 'lightblue',
		        highlightFontSize: 15,
		        highlightStrokeColor: 'orange'
		    },
		    link: {
		        highlightColor: 'orange',
		        color: '#12939A',
		    },
		    height: this.props.height,
		    width: width
		}
		var graph
		if (this.props.fetched && this.props.socialGraph.nodes.length > 0) {
            console.log(this.props.socialGraph)
			graph = <Graph id='social-graph'
					config={myConfig}
					data={this.props.socialGraph}/>
		}
		else {
			graph = <Loader active>Fetching Social Graph</Loader>
		}

		console.log(this.props)
		return (
			<div>
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
