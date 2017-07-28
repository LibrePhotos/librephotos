import React, {Component} from 'react'
import {Grid, Segment, Header} from 'semantic-ui-react'
import Dimensions from 'react-dimensions'
import { connect } from "react-redux";
import { Graph } from 'react-d3-graph';
import {fetchPhotos} from '../../actions/photosActions'

import Month from 'calendar-months';
import {Chart, Bars, Lines, Ticks, Layer, Pies, Transform} from 'rumble-charts'
import {Sunburst} from 'react-vis';




export class CountryPiChart extends Component {
  constructor(props) {
    super(props)
    this.preprocess = this.preprocess.bind(this)
  }

  componentDidMount() {
    this.props.dispatch(fetchPhotos())
  }

  preprocess() {
    var countries = []
    var wheres = []
    this.props.photos.map(function(photo){
      if (photo.geolocation != null) {

        var where = null
        if (photo.geolocation.address.state != null) {
          var where = photo.geolocation.address.state
        }
        if (photo.geolocation.address.city != null) {
          var where = photo.geolocation.address.city
        }
        if (photo.geolocation.address.village != null) {
          var where = photo.geolocation.address.village
        }
        if (photo.geolocation.address.town != null) {
          var where = photo.geolocation.address.town
        }
        if (where==null) {
        }

        wheres.push(where)

        var country = photo.geolocation.address.country_code
        countries.push(country)
      }
    })
    var countries_uniq = countries.filter(function(v,i) { return i==countries.lastIndexOf(v); })
    var counts_countries = countries_uniq.map(function(country){
      var count = countries.filter(function(c){
        if (c==country) {
          return true
        } else {
          return false
        }
      }).length
      return count
    })


    var wheres_uniq = wheres.filter(function(v,i) { return i==wheres.lastIndexOf(v); })
    var counts_wheres = wheres_uniq.map(function(where){
      var count = wheres.filter(function(c){
        if (c==where) {
          return true
        } else {
          return false
        }
      }).length
      return count
    })

    return counts_countries
  }


  preprocessReactVis() {
    var countries = []
    var wheres = []
    var photos = this.props.photos

    this.props.photos.map(function(photo){
      if (photo.geolocation != null) {

        var where = null
        if (photo.geolocation.address.state != null) {
          var where = photo.geolocation.address.state
        }
        if (photo.geolocation.address.city != null) {
          var where = photo.geolocation.address.city
        }
        if (photo.geolocation.address.village != null) {
          var where = photo.geolocation.address.village
        }
        if (photo.geolocation.address.town != null) {
          var where = photo.geolocation.address.town
        }
        if (where==null) {
        }

        wheres.push(where)

        var country = photo.geolocation.address.country_code
        countries.push(country)
      }
    })

    var children = []
    var countries_uniq = countries.filter(function(v,i) { return i==countries.lastIndexOf(v); })

    countries_uniq.map(function(country){
      var photosThisCountry = photos.filter(function(photo){
        if (photo.geolocation != null){

          if (photo.geolocation.address.country_code == country) {
            return true
          } else {
            return false
          }
        } else {
          return false
        }

      })
      var wheresThisCountry = []


      photosThisCountry.map(function(photo){
        if (photo.geolocation != null) {
          var where = null
          if (photo.geolocation.address.city != null) {
            var where = photo.geolocation.address.city
          }
          if (photo.geolocation.address.village != null) {
            var where = photo.geolocation.address.village
          }
          if (photo.geolocation.address.town != null) {
            var where = photo.geolocation.address.town
          }
          console.log(where)
          if (where==null) {
            console.log(photo.geolocation)
          }

          if (where!=null) {
            wheresThisCountry.push(where)
          }

        }
      })


      var wheresUniqThisCountry = wheresThisCountry.filter(function(v,i) { return i==wheresThisCountry.lastIndexOf(v); })
      var countWheresThisCountry = wheresUniqThisCountry.map(function(where){
        var count = wheresThisCountry.filter(function(c){
          if (c==where) {
            return true
          } else {
            return false
          }
        }).length
        return count
      })

      var countryNode = []
      wheresUniqThisCountry.map(function(where,idx){
        countryNode.push(
          {
            title:where,
            size:countWheresThisCountry[idx] 
          }
        )
      })
      children.push({"title":country,"children":countryNode})
    })
    return {"title":'countries',"children":children}

  }



  render(){
    if (this.props.fetchedPhotos) {
      var counts = this.preprocess()
      if (counts.length == 0){counts = [1]}
      console.log(counts)
      var series = [{data:counts}]
      var map = (
        <Segment>
          <Header as='h3'>Photos by Country</Header>
            <Chart 
              width={this.props.containerWidth-50}
              height={250}
              series={series}>
              <Transform method={['transpose','stack']}>
                <Pies combined={true}/>
              </Transform>
            </Chart>
        </Segment>
      )

      // var map = (
      //   <Segment>
      //     <Header as='h3'>Photos by Location</Header>
      //     <Sunburst 
      //       colorType="literal"
      //       data={children}
      //       height={250}
      //       width={this.props.containerWidth-50}>
      //     </Sunburst>
      //   </Segment>
      // )

    }
    else {
      var h = `250px`
      var w = `${this.props.containerWidth-50}px`
      var map = (
        <Segment>
          <Header as='h3'># Photos by Country</Header>
            <div style={{height:h, width:w}}></div>
        </Segment>
      )
    }
    return (
      <div>
        {map}
      </div>
    )
  }
}





CountryPiChart = connect((store)=>{
  return {
    photos: store.photos.photos,
    fetchingPhotos: store.photos.fetchingPhotos,
    fetchedPhotos: store.photos.fetchedPhotos
  }
})(CountryPiChart)


export default Dimensions()(CountryPiChart)