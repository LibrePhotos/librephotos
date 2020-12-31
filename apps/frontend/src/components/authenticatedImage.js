import React, { Component } from 'react';
import { Image as BasicImage } from 'semantic-ui-react';
import { connect } from "react-redux";


export class Image extends Component {
	render() {
		const {auth,src, ...rest} = this.props
		const newSource = {
			uri:src,
			headers:{
				Authorization: "Bearer " + auth.access.token
			}
		}
		return (
			<BasicImage 
				{...rest}
				src={newSource}/> 

				
		)
	}
}

Image = connect((store)=>{
  return {
  	auth: store.auth
  }
})(Image)
