import React, { Component } from 'react';
import { Image, Header, Divider } from 'semantic-ui-react';
import { ImageInfoTable } from './imageInfoTable';
import { serverAddress } from '../api_client/apiClient'


export class ModalPhotoViewVertical extends Component {
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
    if (this.props.photos.length > 0) { 
      var update_height  = window.innerHeight-100;
      var update_width = update_height*this.props.photos[this.props.idx].thumbnail_width/this.props.photos[this.props.idx].thumbnail_height

      if (update_width > window.innerWidth-100) {
        var update_width = window.innerWidth-100
        var update_height = update_width*this.props.photos[this.props.idx].thumbnail_height/this.props.photos[this.props.idx].thumbnail_width
      }
      if (this.refs.modalPhotoViewRef){
        this.setState({ width: update_width, height: update_height });
      }
    }
  }



  /**
   * Add event listener
   */
  componentDidMount() {
    this.updateDimensions();
    window.addEventListener("resize", this.updateDimensions.bind(this));
  }

  componentWillUnmount() {
   window.removeEventListener("resize", this.updateDimensions.bind(this)); 
  }

  render() {
    if (this.props.photos.length > 0) {
      var update_height  = window.innerHeight-100;
      var update_width = update_height*this.props.photos[this.props.idx].thumbnail_width/this.props.photos[this.props.idx].thumbnail_height

      if (update_width > window.innerWidth-100) {
        var update_width = window.innerWidth-100
        var update_height = update_width*this.props.photos[this.props.idx].thumbnail_height/this.props.photos[this.props.idx].thumbnail_width
      }
      return (

          <div ref="modalPhotoViewRef">
            <div style={{textAlign:'center'}}>
              <Image 
                inline
                height={update_height} 
                width={update_width}
                src={serverAddress+this.props.photos[this.props.idx].image_url}/>
            </div>
          
            <Header style={{textAlign:'center'}} inverted as='h4'>{this.props.photos[this.props.idx].image_path}</Header>

            <Divider/>

            <div style={{padding:'10px'}}>
              <ImageInfoTable photo={this.props.photos[this.props.idx]}/>
            </div>

          </div>
      )
    } 
    else {
      return <div></div>
    } 
  }
}