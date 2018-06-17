import React, {Component} from 'react';
import { connect } from "react-redux";
import {fetchPeopleAlbums, fetchAutoAlbums, generateAutoAlbums, fetchAutoAlbumsList} from '../actions/albumsActions'
import {AlbumAutoCard, AlbumAutoGallery} from '../components/album'
import {Container, Image, Icon, Header, Button, Card, Label, Popup} from 'semantic-ui-react'
import {fetchCountStats,fetchPhotoScanStatus,
        fetchAutoAlbumProcessingStatus} from '../actions/utilActions'

import {Server, serverAddress} from '../api_client/apiClient'



export class SecuredImage extends Component {
    state ={
        imgData:null
    }

    componentWillMount() {
        Server.get(this.props.src)
          .then((resp)=>{
              console.log(resp)
              this.setState({imgData:resp.data.data})
          })
          .catch((err)=>{
              console.log('img load error')
              console.log(err)
          })
    }
    render() {
        const {imgData} = this.state
        const imgProps = {...this.props, src:'data:image/jpeg;base64,'+imgData}
        
        if (imgData) {
            return (
                <Image {...imgProps}/>
            ) 
        }
        return (
            <div>hello</div>
        )
    }
}
