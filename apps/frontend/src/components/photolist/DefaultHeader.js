import React, { Component } from "react";
import {
  Grid,
  GridColumn,
  GridRow,
  Header,
  Icon,
  Loader,
} from "semantic-ui-react";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { withTranslation, Trans } from "react-i18next";

export class DefaultHeader extends Component {
  render() {
    if (this.props.loading || this.props.numPhotosetItems < 1) {
      return (
        <div>
          <div style={{ height: 60, paddingTop: 10 }}>
            <Header as="h4">
              <Header.Content>
                {this.props.loading
                  ? this.props.t("defaultheader.loading")
                  : this.props.t("defaultheader.noimages")}
                <Loader inline active={this.props.loading} size="mini" />
              </Header.Content>
            </Header>
          </div>

          {this.props.numPhotosetItems < 1 ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: window.innerHeight - TOP_MENU_HEIGHT - 60,
              }}
            >
              <Header>{this.props.noResultsMessage}</Header>
            </div>
          ) : (
            <div></div>
          )}
        </div>
      );
    }

    return (
      <Grid columns={2}>
        <GridRow>
          <GridColumn>
            <Header as="h2" style={{ paddingRight: 10 }}>
              <Icon name={this.props.titleIconName} />
              <Header.Content>
                {this.props.title}{" "}
                <Header.Subheader>
                  {this.props.numPhotosetItems != this.props.numPhotos
                    ? this.props.numPhotosetItems +
                      " " +
                      this.props.t("defaultheader.days") +
                      ", "
                    : ""}
                  {this.props.numPhotos} {this.props.t("defaultheader.photos")}
                  {this.props.additionalSubHeader}
                </Header.Subheader>
              </Header.Content>
            </Header>
          </GridColumn>
          <GridColumn>
            <div
              style={{
                textAlign: "right",
                margin: "0 auto",
                padding: 20,
              }}
            >
              <span style={{ paddingLeft: 5, fontSize: 18 }}>
                <b>
                  {this.props.dayHeaderPrefix
                    ? this.props.dayHeaderPrefix + this.props.date
                    : this.props.date}
                </b>
              </span>
            </div>
          </GridColumn>
        </GridRow>
      </Grid>
    );
  }
}

DefaultHeader = withTranslation()(DefaultHeader);
