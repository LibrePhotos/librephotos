import React, { Component } from "react";
import { Loader, Header, Label } from "semantic-ui-react";
import {
  XYPlot,
  HorizontalGridLines,
  Hint,
  MarkSeries,
  VerticalGridLines,
} from "react-vis";
import Dimensions from "react-dimensions";
import { connect } from "react-redux";
import { serverAddress } from "../api_client/apiClient";
import { clusterFaces } from "../actions/facesActions";
import { SecuredImageJWT } from "./SecuredImage";


export class FaceClusterScatter extends Component {
  state = {
    crosshairValues: [],
    hintValue: null,
  };

  componentWillMount() {
    this.props.dispatch(clusterFaces());
  }
  render() {
    var person_names = [
      ...new Set(
        this.props.facesVis.map(function (el) {
          return el.person_name;
        })
      ),
    ];
    var facesVis = this.props.facesVis;

    var mappedScatter = person_names.map(function (person_name, idx) {
      var thisPersonVis = facesVis.filter(function (el) {
        return person_name === el.person_name;
      });
      var thisPersonData = thisPersonVis.map(function (el) {
        return {
          x: el.value.x,
          y: el.value.y,
          size: el.value.size,
          name: el.person_name,
          color: el.color,
          face_url: el.face_url,
          photo: el.photo,
        };
      });
      return (
        <MarkSeries
          colorType="literal"
          key={"cluster-marker-" + idx}
          animation
          onValueClick={(d, info) => {
            this.setState({ hintValue: d });
          }}
          data={thisPersonData}
        />
      );
    }, this);
    if (this.props.clustered) {
      return (
        <div style={{ padding: 10 }}>
          <Header as="h3">
            Face Embeddings
            <Header.Subheader>
              People with similar looking faces should be grouped closer
              together in this plot (Click on a point to see the label).
            </Header.Subheader>
          </Header>

          <XYPlot
            width={this.props.containerWidth - 30}
            height={this.props.height}
          >
            <HorizontalGridLines />
            <VerticalGridLines />
            {mappedScatter}
            {this.state.hintValue && (
              <Hint value={this.state.hintValue}>
                <Label color="black">
                  {this.state.hintValue.name}
                  <SecuredImageJWT
                    style={{ borderRadius: "1em" }}
                    floated="right"
                    height={70}
                    width={70}
                    shape="rounded"
                    src={serverAddress + this.state.hintValue.face_url}
                  ></SecuredImageJWT>
                </Label>
              </Hint>
            )}
          </XYPlot>
        </div>
      );
    } else {
      return (
        <div style={{ padding: 10 }}>
          <Loader active />
        </div>
      );
    }
  }
}

FaceClusterScatter = connect((store) => {
  return {
    facesVis: store.faces.facesVis,
    training: store.faces.training,
    trained: store.faces.trained,
    clustering: store.faces.clustering,
    clustered: store.faces.clustered,
  };
})(FaceClusterScatter);

export default Dimensions()(FaceClusterScatter);
