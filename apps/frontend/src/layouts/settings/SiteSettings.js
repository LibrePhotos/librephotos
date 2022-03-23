import React, { Component } from "react";
import { Form, Grid, Radio, Input } from "semantic-ui-react";
import { setSiteSettings } from "../../actions/utilActions";
import { withTranslation, Trans } from "react-i18next";
export default class SiteSettings extends Component {
  state = { skip_patterns: this.props.siteSettings.skip_patterns };

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
                    checked={this.props.siteSettings.allow_registration}
                  />
                </Form.Field>
                <Form.Field>
                  <Radio
                    label={this.props.t("sitesettings.noallow")}
                    name="radioGroup"
                    onChange={() => this.props.dispatch(setSiteSettings({ allow_registration: false }))}
                    checked={!this.props.siteSettings.allow_registration}
                  />
                </Form.Field>
              </Form.Group>
            </Form>
          </Grid.Column>
          <Grid.Column width={4} textAlign="left">
            <b>{this.props.t("sitesettings.headerupload")}</b>
          </Grid.Column>
          <Grid.Column width={12}>
            <Form>
              <Form.Group>
                <Form.Field>
                  <Radio
                    label={this.props.t("sitesettings.allow")}
                    name="radioGroup"
                    onChange={() => this.props.dispatch(setSiteSettings({ allow_upload: true }))}
                    checked={this.props.siteSettings.allow_upload}
                  />
                </Form.Field>
                <Form.Field>
                  <Radio
                    label={this.props.t("sitesettings.noallow")}
                    name="radioGroup"
                    onChange={() => this.props.dispatch(setSiteSettings({ allow_upload: false }))}
                    checked={!this.props.siteSettings.allow_upload}
                  />
                </Form.Field>
              </Form.Group>
            </Form>
          </Grid.Column>
          <Grid.Column width={4} textAlign="left">
            <b>{this.props.t("sitesettings.headerskippatterns")}</b>
          </Grid.Column>
          <Grid.Column width={12}>
            <Form>
              <Form.Group>
                <Form.Field
                  control={Input}
                  label={this.props.t("sitesettings.skippatterns")}
                  value={this.state.skip_patterns}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      this.props.dispatch(setSiteSettings({ skip_patterns: this.state.skip_patterns }));
                    }
                  }}
                  onBlur={() => this.props.dispatch(setSiteSettings({ skip_patterns: this.state.skip_patterns }))}
                  onChange={(e) => this.setState({ skip_patterns: e.target.value })}
                ></Form.Field>
              </Form.Group>
            </Form>
          </Grid.Column>
        </Grid.Row>
      </Grid>
    );
  }
}

SiteSettings = withTranslation()(SiteSettings);
