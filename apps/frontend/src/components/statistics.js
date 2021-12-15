import React, { Component } from "react";
import { Statistic, Icon } from "semantic-ui-react";
import { connect } from "react-redux";
import { fetchCountStats } from "../actions/utilActions";
import { compose } from "redux";
import { withTranslation } from "react-i18next";

export class CountStats extends Component {
  componentDidMount() {
    this.props.dispatch(fetchCountStats());
  }

  render() {
    var statsGroup;
    if (this.props.fetchedCountStats) {
      statsGroup = (
        <div style={{ height: "60px" }}>
          <Statistic.Group size="tiny" widths="five">
            <Statistic>
              <Statistic.Value>
                {this.props.countStats.num_photos}
              </Statistic.Value>
              <Statistic.Label>
                <Icon name="image" />
                {this.props.t("countstats.photos")}
              </Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>
                {this.props.countStats.num_people}
              </Statistic.Value>
              <Statistic.Label>
                <Icon name="users" />
                {this.props.t("people")}
              </Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>
                {this.props.countStats.num_faces}
              </Statistic.Value>
              <Statistic.Label>
                <Icon name="user circle outline" />
                {this.props.t("faces")}
              </Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>
                {this.props.countStats.num_albumauto}
              </Statistic.Value>
              <Statistic.Label>
                <Icon name="wizard" />
                {this.props.t("events")}
              </Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>
                {this.props.countStats.num_albumdate}
              </Statistic.Value>
              <Statistic.Label>
                <Icon name="calendar" />
                {this.props.t("days")}
              </Statistic.Label>
            </Statistic>
          </Statistic.Group>
        </div>
      );
    } else {
      statsGroup = (
        <div style={{ height: "60px" }}>
          <Statistic.Group size="tiny" widths="five">
            <Statistic>
              <Statistic.Value>-</Statistic.Value>
              <Statistic.Label>
                <Icon name="image" />
                {this.props.t("countstats.photos")}
              </Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>-</Statistic.Value>
              <Statistic.Label>
                <Icon name="users" />
                {this.props.t("countstats.people")}
              </Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>-</Statistic.Value>
              <Statistic.Label>
                <Icon name="user circle outline" />
                {this.props.t("countstats.faces")}
              </Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>-</Statistic.Value>
              <Statistic.Label>
                <Icon name="wizard" />
                {this.props.t("countstats.events")}
              </Statistic.Label>
            </Statistic>
            <Statistic>
              <Statistic.Value>-</Statistic.Value>
              <Statistic.Label>
                <Icon name="calendar" />
                {this.props.t("countstats.days")}
              </Statistic.Label>
            </Statistic>
          </Statistic.Group>
        </div>
      );
    }
    console.log("rendering");
    return <div>{statsGroup}</div>;
  }
}

CountStats = compose(
  connect((store) => {
    return {
      countStats: store.util.countStats,
      fetchingCountStats: store.util.fetchingCountStats,
      fetchedCountStats: store.util.fetchedCountStats,
    };
  }),
  withTranslation()
)(CountStats);
