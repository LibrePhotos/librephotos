import React, {Component} from 'react';
import { Card, Image, Header, Divider, Item, Loader, Dimmer, Modal, Grid, 
         Container, Label, Popup, Segment, Button, Icon, Table} from 'semantic-ui-react';




class ModalPhotoViewVertical extends Component {
  constructor() {
    super();
    this.state = {
      width:  100,
      height: 100,
    }
  }
  /**
   * Calculate & Update state of new dimensions
   */
  updateDimensions() {
    var update_height  = window.innerHeight-100;
    var update_width = update_height*this.props.photos[this.props.idx].thumbnail_width/this.props.photos[this.props.idx].thumbnail_height

    if (update_width > window.innerWidth-100) {
      var update_width = window.innerWidth-100
      var update_height = update_width*this.props.photos[this.props.idx].thumbnail_height/this.props.photos[this.props.idx].thumbnail_width
    }
    this.setState({ width: update_width, height: update_height });
  }

  /**
   * Add event listener
   */
  componentDidMount() {
    this.updateDimensions();
    window.addEventListener("resize", this.updateDimensions.bind(this));
  }

  render() {
    return (
      <div style={{padding:'10px'}}>
        <div style={{textAlign:'center'}}>
          <Image 
            inline
            height={this.state.height} 
            width={this.state.width}
            src={serverAddress+this.props.photos[this.props.idx].image_url}/>
        </div>
      
        <Divider/>

        <div style={{padding:'10px'}}>
          <ImageInfoTable photo={this.props.photos[this.props.idx]}/>
        </div>

      </div>
    )
  }
}