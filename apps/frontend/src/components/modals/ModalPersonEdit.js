import React, { Component } from "react";
import { Popup, Input, Image, Header, Divider, Button } from "semantic-ui-react";

import { SecuredImageJWT } from "../../components/SecuredImage";
import { connect } from "react-redux";
import { setFacesPersonLabel } from "../../actions/facesActions";
import _ from "lodash";
import { fetchPeople } from "../../actions/peopleActions";
import { serverAddress } from "../../api_client/apiClient";
import Modal from "react-modal";

import { withTranslation } from "react-i18next";
import { compose } from "redux";

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern
      .split("")
      .map((a) => _.escapeRegExp(a))
      .reduce(function (a, b) {
        return a + ".*" + b;
      });
    return new RegExp(pattern).test(str);
  } else {
    return false;
  }
}

const modalStyles = {
  content: {
    top: 150,
    left: 40,
    right: 40,
    height: window.innerHeight - 300,

    overflow: "hidden",
    padding: 0,
    backgroundColor: "white",
  },
  overlay: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    position: "fixed",
    borderRadius: 0,
    border: 0,
    zIndex: 102,
    backgroundColor: "rgba(200,200,200,0.8)",
  },
};

export class ModalPersonEdit extends Component {
  state = { newPersonName: "" };
  render() {
    var filteredPeopleList = this.props.people;
    if (this.state.newPersonName.length > 0) {
      filteredPeopleList = this.props.people.filter((el) =>
        fuzzy_match(el.text.toLowerCase(), this.state.newPersonName.toLowerCase())
      );
    }

    const allFaces = _.concat(this.props.inferredFacesList, this.props.labeledFacesList);

    var selectedImageIDs = this.props.selectedFaces.map((faceID) => {
      const res = allFaces.filter((face) => face.id === faceID)[0].image;
      const splitBySlash = res.split("/");
      console.log(splitBySlash[splitBySlash.length - 1]);
      const faceImageID = splitBySlash[splitBySlash.length - 1];
      return faceImageID;
    });
    return (
      <Modal
        ariaHideApp={false}
        onAfterOpen={() => {
          fetchPeople(this.props.dispatch);
        }}
        isOpen={this.props.isOpen}
        onRequestClose={() => {
          this.props.onRequestClose();
          this.setState({ newPersonName: "" });
        }}
        style={modalStyles}
      >
        <div style={{ height: 50, width: "100%", padding: 7 }}>
          <Header>
            <Header.Content>
              {this.props.t("personedit.labelfaces")}
              <Header.Subheader>
                {this.props.t("personedit.numberselected", {
                  number: this.props.selectedFaces.length,
                })}
              </Header.Subheader>
            </Header.Content>
          </Header>
        </div>
        <Divider fitted />
        <div style={{ padding: 5, height: 50, overflowY: "hidden" }}>
          <Image.Group>
            {selectedImageIDs.map((image) => (
              <SecuredImageJWT
                key={"selected_image" + image}
                height={40}
                width={40}
                src={serverAddress + "/media/faces/" + image}
              />
            ))}
          </Image.Group>
        </div>
        <Divider fitted />
        <div
          style={{
            paddingLeft: 10,
            paddingTop: 10,
            overflowY: "scroll",
            height: window.innerHeight - 300 - 100,
            width: "100%",
          }}
        >
          <div style={{ paddingRight: 5 }}>
            <Header as="h4">{this.props.t("personedit.newperson")}</Header>
            <Popup
              inverted
              content={this.props.t("personalbum.personalreadyexists", {
                name: this.state.newPersonName.trim(),
              })}
              position="bottom center"
              open={this.props.people
                .map((el) => el.text.toLowerCase().trim())
                .includes(this.state.newPersonName.toLowerCase().trim())}
              trigger={
                <Input
                  fluid
                  error={this.props.people
                    .map((el) => el.text.toLowerCase().trim())
                    .includes(this.state.newPersonName.toLowerCase().trim())}
                  onChange={(e, v) => {
                    this.setState({ newPersonName: v.value });
                  }}
                  placeholder={this.props.t("personedit.personname")}
                  action
                >
                  <input />
                  <Button
                    positive
                    onClick={() => {
                      this.props.dispatch(setFacesPersonLabel(this.props.selectedFaces, this.state.newPersonName));
                      this.props.onRequestClose();
                      this.setState({ newPersonName: "" });
                    }}
                    disabled={this.props.people
                      .map((el) => el.text.toLowerCase().trim())
                      .includes(this.state.newPersonName.toLowerCase().trim())}
                    type="submit"
                  >
                    {this.props.t("personedit.addperson")}
                  </Button>
                </Input>
              }
            />
          </div>
          <Divider />
          {filteredPeopleList.length > 0 &&
            filteredPeopleList.map((item) => {
              return (
                <div
                  key={"modal_person_face_label_" + item.text}
                  style={{
                    height: 70,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Header
                    as="h4"
                    onClick={() => {
                      this.props.dispatch(setFacesPersonLabel(this.props.selectedFaces, item.text));
                      this.props.onRequestClose();
                      // console.log('trying to add photos: ',this.props.selectedFaces)
                      // console.log('to user album id: ',item.id)
                    }}
                  >
                    <SecuredImageJWT circular height={60} width={60} src={serverAddress + item.face_url} />
                    <Header.Content>
                      {item.text}
                      <Header.Subheader>
                        {this.props.t("numberofphotos", {
                          number: item.face_count,
                        })}
                      </Header.Subheader>
                    </Header.Content>
                  </Header>
                </div>
              );
            })}
        </div>
      </Modal>
    );
  }
}

ModalPersonEdit = compose(
  connect((store) => {
    return {
      people: store.people.people,
      fetchingPeople: store.people.fetchingPeople,
      fetchedPeople: store.people.fetchedPeople,

      inferredFacesList: store.faces.inferredFacesList,
      labeledFacesList: store.faces.labeledFacesList,

      fetchingLabeledFacesList: store.faces.fetchingLabeledFacesList,
      fetchedLabeledFacesList: store.faces.fetchedLabeledFacesList,
      fetchingInferredFacesList: store.faces.fetchingInferredFacesList,
      fetchedInferredFacesList: store.faces.fetchedInferredFacesList,
    };
  }),
  withTranslation()
)(ModalPersonEdit);
