import React, {Component} from 'react'
import {Loader, Segment, Header,Label} from 'semantic-ui-react'
import {XYPlot, XAxis, YAxis, HorizontalGridLines, Hint,
        MarkSeries, VerticalGridLines, Crosshair} from 'react-vis';
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { Graph } from 'react-d3-graph';
import { fetchSocialGraph } from '../actions/peopleActions'
import {trainFaces, clusterFaces} from '../actions/facesActions';

export class FaceClusterScatter extends Component {
    state = {
        crosshairValues: [],
        hintValue:null
    };

  componentWillMount() {
    this.props.dispatch(clusterFaces())
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
            color: el.color,
          }
        )
      })
      return (
        <MarkSeries 
            colorType="literal" 
            key={"cluster-marker-"+idx} 
            animation 
            onValueClick={(d,info)=>{
                this.setState({hintValue:d})
            }}
            data={thisPersonData}/>
      )
    },this)
    if (this.props.clustered) {
        return (
        <div style={{padding:10}}>
            <Header as='h3'>
                Face Embeddings
                <Header.Subheader>
                    People with similar looking faces should be grouped closer together in this plot (Click on a point to see the label).
                </Header.Subheader>
            </Header>

            <XYPlot
            width={this.props.containerWidth-30}
            height={this.props.height}>
            <HorizontalGridLines/>
            <VerticalGridLines/>
            {mappedScatter}
            { this.state.hintValue && (
                <Hint value={this.state.hintValue}>
                        <Label color='black'>{this.state.hintValue.name}</Label>
                </Hint>
            )} 
            </XYPlot>
        </div>
        )
    } else {
        return (
            <div style={{padding:10}}><Loader active/></div>
        )
    }

  }
}



FaceClusterScatter = connect((store)=>{
  return {
    facesVis: store.faces.facesVis,
    training: store.faces.training,
    trained: store.faces.trained,
    clustering: store.faces.clustering,
    clustered: store.faces.clustered,
  }
})(FaceClusterScatter)


export default Dimensions()(FaceClusterScatter)
