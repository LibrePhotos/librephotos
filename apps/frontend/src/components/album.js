import React, {Component} from 'react';
import { Image, Header, Divider, Item, Container} from 'semantic-ui-react';
import Server from '../api_client/apiClient';
import Gallery from 'react-grid-gallery';

class AlbumDatePhotoGroup extends Component{
  render() {
    var mappedRenderablePhotoArray = this.props.photos.map(function(photo){
      return ({
        src: "http://localhost:8000"+photo.image_url,
        thumbnail: "http://localhost:8000"+photo.thumbnail_url,
        thumbnailWidth:photo.thumbnail_width,
        thumbnailHeight:photo.thumbnail_height,
      });
    });

    return (
      <div style={{
        display: "block",
        minHeight: "1px",
        width: "100%",
        border: "0px solid #ddd",
        overflow: "auto"}}>
        <Gallery 
          images={mappedRenderablePhotoArray}
          enableImageSelection={false}
          rowHeight={100}/>
      </div>
    );
  }
}

class AlbumDate extends Component {
  render() {
    return (
      <div>

        <AlbumDatePhotoGroup photos={this.props.album.photos} />
        <Divider />
      </div>
    );
  }
}

export class AlbumDates extends Component{
  constructor(props) {
    super(props)
    this.setState({albums:[]})
  }

  componentWillMount() {
    var _this = this
    this.serverRequest = 
      Server
        .get('albums/date/')
        .then(function(response) {
          _this.setState({
            albums: response.data.results
          });
        })
      console.log(this.state)
  }

  componentWillUnmount() {
    this.serverRequest.abort();
  }

  render() {
    console.log(this.state)
    var mappedAlbums = this.state.albums.map(function(album){
      return (
          <AlbumDate album={album} />
      );
    })
    return (
      <Container>
        {mappedAlbums}
      </Container>
    );
  }
}


export default { AlbumDates };
