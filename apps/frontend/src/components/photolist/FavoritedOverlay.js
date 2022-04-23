import React, { Component } from "react";
import { connect } from "react-redux";
import { Icon } from "semantic-ui-react";

export default class FavoritedOverlay extends Component {
  render() {
    return (
      <span>{this.props.item.rating >= this.props.favorite_min_rating && <Icon name="star" color="yellow" />}</span>
    );
  }
}

FavoritedOverlay = connect(store => ({
  favorite_min_rating: store.user.userSelfDetails.favorite_min_rating,
}))(FavoritedOverlay);
