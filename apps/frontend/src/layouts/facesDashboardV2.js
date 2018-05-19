import React, {Component} from 'react'
import { Grid, Image, Icon, Header, Container, Divider, Button, Label, Loader, Sticky, Accordion} from 'semantic-ui-react'
import {FaceToLabel, FacesLabeled, FacesInferred, FaceStatistics, FaceTableLabeled, FaceTableInferred} from '../components/faces'
import  FaceClusterScatter  from '../components/faceClusterGraph'
import { connect } from "react-redux";
import {loadFaceToLabel, trainFaces, clusterFaces, fetchInferredFacesList, fetchLabeledFacesList, fetchFacesList} from '../actions/facesActions';
import { Grid as RVGrid, List, WindowScroller,AutoSizer } from 'react-virtualized';
import LazyLoad from 'react-lazyload';
import _ from 'lodash'
// <Icon name='id badge' circular />
var topMenuHeight = 55 // don't change this
var leftMenuWidth = 85 // don't change this
var SIDEBAR_WIDTH = 85

class PersonFaceGrid extends Component {
  constructor(props){
    super(props)
    this.cellRenderer = this.cellRenderer.bind(this)
    this.toggleCollapse = this.toggleCollapse.bind(this)
    this.state = {collapsed:true}
  }

  toggleCollapse = () => {this.setState({collapsed:!this.state.collapsed})}

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    var idx = rowIndex*this.props.numItemsPerRow+columnIndex
    if ( idx < this.props.faces.length) {
      return (
        <div key={key} style={style}>
          <Image
            onClick={()=>this.props.dispatch(loadFaceToLabel(this.props.faces[idx]))}
            style={{padding:3,borderRadius:'1em',zIndex:0}} 
            height={this.props.itemSize} 
            width={this.props.itemSize} 
            src={this.props.faces[idx].image} circular/>
        </div>
      )
    }
    else {
      return (
        <div></div>
      )
    }
  }


  render() {
    var numRows = Math.ceil(this.props.faces.length/this.props.numItemsPerRow.toFixed(1))
    if (numRows < 5) {
      var maxHeight = this.props.itemSize*numRows
    }
    else {
      var maxHeight = this.props.itemSize*4
    }

    return (
      <div style={{zIndex:0}}>
        <div style={{paddingTop:10,zIndex:0}}>
        <Header onClick={()=>this.toggleCollapse()} as='h4'>
          {<Icon name={this.state.collapsed ? 'triangle right' : 'triangle down'}/>} 
          {this.props.faces[0].person_name} 
          ({this.props.faces.length})
        </Header>      
        </div>
        
        <div style={{zIndex:0}}>
        <AutoSizer disableHeight style={{outline:'none',padding:0,margin:0,zIndex:0}}>
          {({width}) => (
            <RVGrid
              style={{outline:'none', zIndex:0}}
              cellRenderer={this.cellRenderer}
              columnWidth={this.props.itemSize}
              columnCount={this.props.numItemsPerRow}
              height={this.state.collapsed ? this.props.itemSize : maxHeight}
              rowHeight={this.props.itemSize}
              rowCount={this.state.collapsed ? 1 : Math.ceil(this.props.faces.length/this.props.numItemsPerRow.toFixed(1))}
              width={width}
            />
          )}
        </AutoSizer>
        </div>
      </div>
    )
  }
}

class FaceGridList extends Component {
  render() {
    var people = {}
    this.props.facesList.forEach((face)=>{
      if (people.hasOwnProperty(face.person_name)) {
        people[face.person_name].push(face)
      } 
      else {
        people[face.person_name]=[]
        people[face.person_name].push(face)
      }
    })

    console.log(people)

    if (Object.keys(people).length > 0){
      return (
        <div style={{paddingLeft:15}}>
          { Object.keys(_(people).toPairs().sortBy(0).fromPairs().value()).map((person)=>
              <PersonFaceGrid 
                itemSize={this.props.itemSize}
                numItemsPerRow={this.props.numItemsPerRow}
                faces={people[person]}/>
          )}
        </div>
      )
    }
    else {
      return (
        <div></div>
      )
    }
  }
}



export class FacesDashboardV2 extends Component {
    state = {
    width:  window.innerWidth,
    height: window.innerHeight,
    entrySquareSize:50,
    inferredActive: false,
    labeledActive:false,
  }
  
  constructor(props) {
    super(props)
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this)

  }

  handleContextRef = contextRef => this.setState({ contextRef })

  componentWillMount() {
    this.props.dispatch(fetchInferredFacesList())
    this.props.dispatch(fetchLabeledFacesList())
    this.props.dispatch(fetchFacesList())
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
  }

  trainHandler = e => {
    this.props.dispatch(trainFaces())
  }




  calculateEntrySquareSize() {
    if (window.innerWidth < 600) {
      var numEntrySquaresPerRow = 4
    } 
    else if (window.innerWidth < 800) {
      var numEntrySquaresPerRow = 6
    }
    else if (window.innerWidth < 1000) {
      var numEntrySquaresPerRow = 8
    }
    else if (window.innerWidth < 1200) {
      var numEntrySquaresPerRow = 10
    }
    else {
      var numEntrySquaresPerRow = 10
    }

    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 30 - 15


    var entrySquareSize = columnWidth / numEntrySquaresPerRow
    var numEntrySquaresPerRow = numEntrySquaresPerRow 
    this.setState({
      width:  window.innerWidth,
      height: window.innerHeight,
      entrySquareSize:entrySquareSize,
      numEntrySquaresPerRow:numEntrySquaresPerRow
    })
    console.log('column width:',columnWidth)
    console.log('item size:',entrySquareSize)
    console.log('num items per row',numEntrySquaresPerRow)
  }



  render() {
    const { contextRef } = this.state

    return (
      <div style={{paddingTop:topMenuHeight}}>
          <div style={{
            zIndex:1000,
            position:'fixed',
            float:'left',
            top:topMenuHeight+5,
            left:SIDEBAR_WIDTH+5,
            width:window.innerWidth-SIDEBAR_WIDTH-25}}>
            <FaceToLabel/>
          </div>
          
          <div style={{paddingTop:200}}>

          <Button as='div' labelPosition='right'>
            <Button 
              loading={this.props.fetchingInferredFacesList}
              active={this.state.inferredActive} 
              color='blue' 
              onClick={()=>{this.setState({inferredActive:!this.state.inferredActive})}}>
            <Icon name={!this.state.inferredActive ? 'triangle right' : 'triangle down'}/>Inferred Faces
            </Button>
            <Label basic pointing='left' color='blue'>
              {this.props.inferredFacesList.length}
            </Label>
          </Button> 
          { this.state.inferredActive ? 
            (
              <FaceGridList 
                itemSize={this.state.entrySquareSize}
                numItemsPerRow={this.state.numEntrySquaresPerRow}
                facesList={this.props.inferredFacesList}/>
            ) : (
              <div></div>
            )
          }

          <Divider hidden/>

          <Button as='div' labelPosition='right'>
            <Button 
              loading={this.props.fetchingLabeledFacesList}
              active={this.state.labeledActive} 
              color='green' 
              onClick={()=>{this.setState({labeledActive:!this.state.labeledActive})}}>
            <Icon name={!this.state.labeledActive ? 'triangle right' : 'triangle down'}/>Labeled Faces
            </Button>
            <Label basic pointing='left' color='green'>
              {this.props.labeledFacesList.length}
            </Label>
          </Button>           
          { this.state.labeledActive ? 
            (
              <FaceGridList 
                itemSize={this.state.entrySquareSize}
                numItemsPerRow={this.state.numEntrySquaresPerRow}
                facesList={this.props.labeledFacesList}/>
            ) : (
              <div></div>
            )
          }



          </div>
      </div>
    )
  }
}


FacesDashboardV2 = connect((store)=>{
  return {
    facesList: store.faces.facesList,
    inferredFacesList: store.faces.inferredFacesList,
    labeledFacesList: store.faces.labeledFacesList,

    facesVis: store.faces.facesVis,
    training: store.faces.training,
    trained: store.faces.trained,
    fetchingLabeledFacesList: store.faces.fetchingLabeledFacesList,
    fetchedLabeledFacesList: store.faces.fetchedLabeledFacesList,
    fetchingInferredFacesList: store.faces.fetchingInferredFacesList,
    fetchedInferredFacesList: store.faces.fetchedInferredFacesList,
  }
})(FacesDashboardV2)



PersonFaceGrid = connect((store)=>{
  return {}
})(PersonFaceGrid)




/*
            <Header>Inferred Faces <Loader inline size='mini' active={this.props.fetchingInferredFacesList}/></Header>

            <FaceGridList 
              itemSize={this.state.entrySquareSize}
              numItemsPerRow={this.state.numEntrySquaresPerRow}
              facesList={this.props.inferredFacesList}/>

            <Divider/>

            <Header>Labeled Faces <Loader inline size='mini' active={this.props.fetchingLabeledFacesList}/></Header>

            <FaceGridList 
              itemSize={this.state.entrySquareSize}
              numItemsPerRow={this.state.numEntrySquaresPerRow}
              facesList={this.props.labeledFacesList}/>
*/