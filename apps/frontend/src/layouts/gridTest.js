import ReactGridLayout from 'react-grid-layout'
import React, { Component } from 'react'
import { Image } from 'semantic-ui-react'


export class MyGrid extends Component {
  render() {
    // layout is an array of objects, see the demo for more complete usage
    var layout = [
      {i: 'a', x: 0, y: 0, w: 1, h: 2, static: true},
      {i: 'b', x: 1, y: 0, w: 3, h: 2, minW: 2, maxW: 4},
      {i: 'c', x: 4, y: 0, w: 1, h: 2}
    ];
    return (
      <ReactGridLayout className="layout" layout={layout} cols={12} rowHeight={30} width={1200}>
        <div key={'a'}><Image height={200} width={200} src={'..'}/></div>
        <div key={'b'}><Image height={200} width={200} src={'..'}/></div>
        <div key={'c'}><Image height={200} width={200} src={'..'}/></div>
      </ReactGridLayout>
    )
  }
}