import React, {Component} from 'react'
import { Grid, Image, Icon, Header, Container, Divider, Button, Loader} from 'semantic-ui-react'
import {FaceToLabel, FacesLabeled, FacesInferred, FaceStatistics, FaceTableLabeled, FaceTableInferred} from '../components/faces'
import  FaceClusterScatter  from '../components/faceClusterGraph'
import { connect } from "react-redux";
import {trainFaces, clusterFaces} from '../actions/facesActions';

