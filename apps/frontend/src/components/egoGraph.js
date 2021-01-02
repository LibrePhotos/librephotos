import React, { Component } from 'react'
import { Loader } from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { Graph } from 'react-d3-graph';
import { fetchEgoGraph } from '../actions/peopleActions'


export class EgoGraph extends Component {
	componentWillMount() {
		if (!this.props.egoGraph.hasOwnProperty(this.props.person_id)){
			this.props.dispatch(fetchEgoGraph(this.props.person_id))
		}
	}

	render(){

		var data = this.props.socialGraph
		var myConfig = {
			automaticRearrangeAfterDropNode: false,
			staticGraph:false,
		    highlightBehavior: true,
		    maxZoom: 4,
		    minZoom: 0.1,
		    node: {
		    	fontSize: 17,
		    	size: 600,
		        color: 'lightblue',
		        highlightFontSize: 17,
		        highlightStrokeColor: 'orange'
		    },
		    link: {
		        highlightColor: 'orange',
		        color: '#12939A',
		    },
		    height: this.props.height,
		    width: this.props.width
		}

		if (this.props.egoGraph.hasOwnProperty(this.props.person_id)) {
			var graph = <Graph id='social-graph'
					config={myConfig}
					data={this.props.egoGraph[this.props.person_id]}/>
		}
		else {
			var graph = <Loader/>
		}

		return (
	        <div style={{padding:0,height:this.props.height}}>
  			{graph}
			</div>
		)
	}
}




EgoGraph = connect((store)=>{
  return {
    egoGraph: store.people.egoGraph,
    fetching: store.people.fetchingEgoGraph,
    fetched: store.people.fetchedEgoGraph,
  }
})(EgoGraph)

export default Dimensions()(EgoGraph)