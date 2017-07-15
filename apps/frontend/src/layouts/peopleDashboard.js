import React, { Component } from 'react';
import { connect } from "react-redux";
import { Image, Header, Message, Dropdown, Divider, Card, 
         Container, Segment, Button, Icon, Popup, Loader, 
         Dimmer, Grid, Reveal, Statistic, Label, Table,
         Modal } from 'semantic-ui-react';
import { fetchPeople, 
         addPerson ,
         addPersonAndSetLabelToFace} from '../actions/peopleActions';
import { fetchFaces, 
         fetchLabeledFaces,
         fetchInferredFaces,
         deleteFaceAndFetchNext, 
         labelFacePerson ,
         fetchFaceToLabel,
         loadFaceToLabel,
         labelFacePersonAndFetchNext} from '../actions/facesActions';

export class PeopleDashboard extends Component {
   render(){
      <Grid stackable columns={4}>
      </Grid>
   }
}