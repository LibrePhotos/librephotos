import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Divider, Form, Header, Image, Message, Segment } from "semantic-ui-react";

import { fetchSiteSettings } from "../../actions/utilActions";
import { login } from "../../actions/authActions";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { useTranslation } from "react-i18next";

import { authErrors } from "../../reducers";
export const LoginPage = () => {
  const { siteSettings } = useAppSelector((state) => state.util);
  const errors = useAppSelector((state) => authErrors(state));
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    fetchSiteSettings(dispatch);
  }, [dispatch]);

  const onSubmit = (event: any) => {
    event.preventDefault();
    login(username.toLowerCase(), password, "", dispatch);
  };
  const timeNow = new Date().toLocaleTimeString();

  return (
    <div
      style={{
        paddingTop: 150,
        position: "fixed",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        overflowY: "auto",
        backgroundColor: "#dddddd",
        backgroundSize: "cover",
      }}
    >
      <div style={{ maxWidth: 500, padding: 20, margin: "0 auto" }}>
        <div
          style={{
            maxWidth: 400,
            textAlign: "center",
            margin: "0 auto",
            padding: 20,
          }}
        >
          <Image src={"/logo.png"} size="tiny" verticalAlign="middle" />{" "}
          <span style={{ paddingLeft: 5, fontSize: 18 }}>
            <b>{t("login.name")}</b>
          </span>
        </div>

        <Segment attached>
          <Header>{t("login.login")}</Header>

          <Form onSubmit={onSubmit}>
            <Form.Field>
              <label>{t("login.username")}</label>
              <Form.Input
                icon="user"
                placeholder={t("login.usernameplaceholder")}
                name="username"
                value={username}
                onChange={(e, { name, value }) => setUsername(value)}
              />
            </Form.Field>
            <Form.Field>
              <label>{t("login.password")}</label>
              <Form.Input
                icon="lock"
                type="password"
                placeholder={t("login.passwordplaceholder")}
                name="password"
                value={password}
                onChange={(e, { name, value }) => setPassword(value)}
              />
              <Divider />
              <Form.Button fluid color="blue" content="Log in" />

              {siteSettings.allow_registration && (
                <div>
                  <Divider />
                  <Button
                    disabled={!siteSettings.allow_registration}
                    as={Link}
                    to="/signup"
                    fluid
                    color="green"
                    content={t("login.signup")}
                  />
                </div>
              )}
            </Form.Field>
          </Form>
        </Segment>
        {errors && errors.data && errors.data.detail && (
          <Message color="red" secondary attached>
            <p>{errors.data.detail}</p>
            <p>{timeNow}</p>
          </Message>
        )}
        {errors && errors.data && !errors.data.detail && (
          <Message color="red" secondary attached>
            <p>{t("login.errorbackend")}</p>
            <p>{timeNow}</p>
          </Message>
        )}
        {errors && errors.password && (
          <Message color="red" secondary attached>
            <p>{t("login.errorpassword")}</p>
            <p>{timeNow}</p>
          </Message>
        )}
        {errors && errors.username && (
          <Message color="red" secondary attached="bottom">
            <p>{t("login.errorusername")}</p>
            <p>{timeNow}</p>
          </Message>
        )}
      </div>
      <div
        style={{
          maxWidth: 400,
          textAlign: "center",
          paddingTop: "10%",
          margin: "0 auto",
        }}
      >
        {t("login.tagline")}
      </div>
    </div>
  );
};
