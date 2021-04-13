import React, { Component } from 'react'
import { Header,Loader } from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { fetchWordCloud } from '../../actions/utilActions'
import { Chart, Transform, Cloud } from 'rumble-charts'


export class WordCloud extends Component {

  componentDidMount() {
    if (!this.props.fetchedWordCloud) {
      this.props.dispatch(fetchWordCloud())
    }
  }



  render(){
    var title = 'People'
    if (this.props.type==='captions'){
      title = 'Things'
    }
    if (this.props.type==='location'){
      title = 'Locations'
    }
    var chart
    if (this.props.fetchedWordCloud) {
      var wordCloud = this.props.wordCloud
      var series = [{data:wordCloud.people}]  
      if (this.props.type==='captions'){
        series = [{data:wordCloud.captions}]
      }
      else if (this.props.type==='location'){
        series = [{data:wordCloud.locations}]        
      }
      chart = (
        <div>
          <Header as='h3'>{title}</Header>
            <Chart 
              width={this.props.containerWidth-50}
              height={this.props.height-70}
              series={series}>
              <Transform method={['transpose']}>
                <Cloud font='sans-serif' minFontsSize={10} maxFontSize={50}/>
              </Transform>
            </Chart>
        </div>
      )
    }
    else {
      var h = this.props.height-70
      var w = this.props.containerWidth+60
      chart = (
        <div>
          <Header as='h3'>{title}{" "}<Loader inline size='mini' active/></Header>
            <div style={{height:h, width:w}}>
            
            </div>
        </div>
      )
    }
    return (
            <div>
        {chart}
        </div>
    )
  }
}

WordCloud = connect((store)=>{
  return {
    wordCloud: store.util.wordCloud,
    fetchingWordCloud: store.util.fetchingWordCloud,
    fetchedWordCloud: store.util.fetchedWordCloud,
  }
})(WordCloud)


export default Dimensions()(WordCloud)
