import React, {Component} from 'react'
import { Grid, Image, Icon, Header, Container, Divider, Button} from 'semantic-ui-react'
import {FaceToLabel, FacesLabeled, FacesInferred, FaceStatistics, FaceTableLabeled, FaceTableInferred} from '../components/faces'
import FaceClusterScatter from '../components/graphs'
import { connect } from "react-redux";
import {trainFaces} from '../actions/facesActions';

export class FacesDashboard extends Component {

	trainHandler = e => {
		this.props.dispatch(trainFaces())
	}

  render() {
    return (
      <Container>
        <Header as='h2' icon textAlign='center'>
          <Icon name='id badge' circular />
          <Header.Content>
          	Label and analyze the trained face classifier!
          </Header.Content>
        </Header>

        <Grid stackable divided columns={2}>
        	<Grid.Column width={6}>
        	<FaceToLabel/>
        	<Divider/>
        	<Button color='blue' fluid onClick={this.trainHandler}>Train</Button>
        	</Grid.Column>

        	<Grid.Column width={10}>
	        	<FaceClusterScatter/>
        	</Grid.Column>

        </Grid>

        <Header as='h3'>Inferred</Header>
				<FaceTableInferred/>      
        <Header as='h3'>Labeled</Header>
				<FaceTableLabeled/>      
      </Container>
    )
  }
}


FacesDashboard = connect((store)=>{
  return {
    facesVis: store.faces.facesVis,
    training: store.faces.training,
    trained: store.faces.trained,
  }
})(FacesDashboard)



