import React, { Component } from "react";
import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import { compose } from "redux";
import { Icon, Statistic } from "semantic-ui-react";

import { fetchCountStats } from "../actions/utilActions";

export class CountStats extends Component {
  componentDidMount() {
    this.props.dispatch(fetchCountStats());
  }

  render() {
    return (
      <div style={{ height: "60px", width: "90vw" }}>
        <Statistic.Group size="tiny" widths="five">
          <Statistic>
            <Statistic.Value>{this.props.countStats.num_photos}</Statistic.Value>
            <Statistic.Label>
              <Icon name="image" />
              {this.props.t("countstats.photos")}
            </Statistic.Label>
          </Statistic>
          <Statistic>
            <Statistic.Value>{this.props.countStats.num_people}</Statistic.Value>
            <Statistic.Label>
              <Icon name="users" />
              {this.props.t("people")}
            </Statistic.Label>
          </Statistic>
          <Statistic>
            <Statistic.Value>{this.props.countStats.num_faces}</Statistic.Value>
            <Statistic.Label>
              <Icon name="user circle outline" />
              {this.props.t("faces")}
            </Statistic.Label>
          </Statistic>
          <Statistic>
            <Statistic.Value>{this.props.countStats.num_albumauto}</Statistic.Value>
            <Statistic.Label>
              <Icon name="wizard" />
              {this.props.t("events")}
            </Statistic.Label>
          </Statistic>
          <Statistic>
            <Statistic.Value>{this.props.countStats.num_albumdate}</Statistic.Value>
            <Statistic.Label>
              <Icon name="calendar" />
              {this.props.t("days")}
            </Statistic.Label>
          </Statistic>
        </Statistic.Group>
      </div>
    );
  }
}

CountStats = compose(
  connect(store => ({
    countStats: store.util.countStats,
    fetchingCountStats: store.util.fetchingCountStats,
    fetchedCountStats: store.util.fetchedCountStats,
  })),
  withTranslation()
)(CountStats);
