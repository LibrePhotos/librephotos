import React, { Component } from "react";
import { Trans, withTranslation } from "react-i18next";
import { Dropdown, Form, Grid, Input, Radio } from "semantic-ui-react";

import { setSiteSettings } from "../../actions/utilActions";

export default class SiteSettings extends Component {
  state = {
    skip_patterns: this.props.siteSettings.skip_patterns,
    map_api_key: this.props.siteSettings.map_api_key,
    heavyweight_process: this.props.siteSettings.heavyweight_process,
  };

  options = [
    { key: "1", text: "1", value: "1" },
    { key: "2", text: "2", value: "2" },
    { key: "3", text: "3", value: "3" },
  ];

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
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      this.props.dispatch(setSiteSettings({ skip_patterns: this.state.skip_patterns }));
                    }
                  }}
                  onBlur={() => this.props.dispatch(setSiteSettings({ skip_patterns: this.state.skip_patterns }))}
                  onChange={e => this.setState({ skip_patterns: e.target.value })}
                />
              </Form.Group>
            </Form>
          </Grid.Column>
          <Grid.Column width={4} textAlign="left">
            <b>{this.props.t("sitesettings.headerapikey")}</b>
          </Grid.Column>
          <Grid.Column width={12}>
            <Form>
              <Form.Group>
                <Form.Field
                  control={Input}
                  label={this.props.t("sitesettings.apikey")}
                  value={this.state.map_api_key}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      this.props.dispatch(setSiteSettings({ map_api_key: this.state.map_api_key }));
                    }
                  }}
                  onBlur={() => this.props.dispatch(setSiteSettings({ map_api_key: this.state.map_api_key }))}
                  onChange={e => this.setState({ map_api_key: e.target.value })}
                />
              </Form.Group>
            </Form>
          </Grid.Column>
          <Grid.Column width={4} textAlign="left">
            <b>{this.props.t("sitesettings.headerheavyweight")}</b>
          </Grid.Column>
          <Grid.Column width={12}>
            <Form>
              <Form.Group>
                <Form.Field
                  control={Input}
                  label={this.props.t("sitesettings.heavyweight")}
                  options={this.options}
                  value={this.state.heavyweight_process}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      this.props.dispatch(setSiteSettings({ heavyweight_process: e.target.value }));
                    }
                  }}
                  onBlur={() =>
                    this.props.dispatch(setSiteSettings({ heavyweight_process: this.state.heavyweight_process }))
                  }
                  onChange={e => {
                    const re = /^[0-9\b]+$/;

                    // if value is not blank, then test the regex
                    if (e.target.value === "" || re.test(e.target.value)) {
                      this.setState({ heavyweight_process: e.target.value });
                    }
                  }}
                />
              </Form.Group>
            </Form>
          </Grid.Column>
        </Grid.Row>
      </Grid>
    );
  }
}

SiteSettings = withTranslation()(SiteSettings);
