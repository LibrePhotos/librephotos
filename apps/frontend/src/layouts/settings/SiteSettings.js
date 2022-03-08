import React, { Component } from "react";
import { Form, Grid, Radio, Input } from "semantic-ui-react";
import { setSiteSettings } from "../../actions/utilActions";
import { withTranslation, Trans } from "react-i18next";
export default class SiteSettings extends Component {
  render() {
    return (
      <Grid>
        <Grid.Row>
          <Grid.Column width={4} textAlign="left">
            <b>{this.props.t("sitesettings.header")}</b>
          </Grid.Column>
          <Grid.Column width={12}>
            <Form>
              <Form.Group>
                <Form.Field>
                  <Radio
                    label={this.props.t("sitesettings.allow")}
                    name="radioGroup"
                    onChange={() => this.props.dispatch(setSiteSettings({ allow_registration: true }))}
                    checked={this.props.allow_registration}
                  />
                </Form.Field>
                <Form.Field>
                  <Radio
                    label={this.props.t("sitesettings.noallow")}
                    name="radioGroup"
                    onChange={() => this.props.dispatch(setSiteSettings({ allow_registration: false }))}
                    checked={!this.props.allow_registration}
                  />
                </Form.Field>
              </Form.Group>
            </Form>
          </Grid.Column>
        </Grid.Row>
      </Grid>
    );
  }
}

SiteSettings = withTranslation()(SiteSettings);
