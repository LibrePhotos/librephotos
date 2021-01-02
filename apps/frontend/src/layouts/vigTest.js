import React, { Component} from "react";
import VirtualizedItemGrid from 'react-virtualized-item-grid';
import { Image } from 'semantic-ui-react';


export class MyList extends Component {
  itemRenderer(item) {
    console.log(item)
    return <div><Image src="http://localhost:8000/media/square_thumbnails/77e17ac90e343dceb146f58b5cca7d93.jpg"/></div>;
  }

  render() {
    return (
      <VirtualizedItemGrid
        idealItemWidth={30}
        items={[1,2,3,4,5]}
        renderItem={this.itemRenderer}/>
    )
  }
}

