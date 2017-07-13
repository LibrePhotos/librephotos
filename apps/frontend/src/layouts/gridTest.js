import React, {Component} from 'react'
import { Grid, Image, Icon, Header, Container, Divider} from 'semantic-ui-react'
import {FaceToLabel, FacesLabeled, FacesInferred} from '../components/FaceCards'

export class GridExampleColumnWidth extends Component {
  render() {
    return (
      <Container>
        <Header as='h2' icon textAlign='center'>
          <Icon name='id badge' circular />
          <Header.Content>
            Faces
          </Header.Content>
        </Header>
        <FaceToLabel/>

        <Header dividing as='h2'>Inferred Faces</Header>
        <FacesInferred/>
        
        <Header dividing as='h2'>Labeled Faces</Header>
        <FacesLabeled/>
        
      
      </Container>
    )
  }
}







export default {GridExampleColumnWidth}

