import React, { Component } from 'react';
import { Image } from 'semantic-ui-react'
import { Server } from '../api_client/apiClient'


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
