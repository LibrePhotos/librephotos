import type { FormEvent } from "react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useHistory } from "react-router-dom";
import { Button, Divider, Form, Header, Image, Segment } from "semantic-ui-react";

import { fetchSiteSettings } from "../../actions/utilActions";
import { useLoginMutation } from "../../api_client/api";
import { authActions } from "../../store/auth/authSlice";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { selectSiteSettings } from "../../store/util/utilSelectors";
import type { ISignInFormState } from "./loginUtils";
import { validateSignInForm } from "./loginUtils";

const initialFormState: ISignInFormState = { username: "", password: "" };

export function LoginPage(): JSX.Element {
  const history = useHistory();
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const siteSettings = useAppSelector(selectSiteSettings);
  const [login, { isSuccess, isLoading }] = useLoginMutation();
  const [form, setForm] = useState<ISignInFormState>(initialFormState);

  useEffect(() => {
    dispatch(authActions.clearError());
    fetchSiteSettings(dispatch);
  }, [dispatch]);

  useEffect(() => {
    if (isSuccess) {
      history.push("/");
    }
  }, [history, isSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void login({ username: form.username.toLowerCase(), password: form.password });
  }

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
          <Image src="/logo.png" size="tiny" verticalAlign="middle" />{" "}
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
                value={form.username}
                onChange={(e, { value }) => setForm(ps => ({ ...ps, username: value }))}
              />
            </Form.Field>
            <Form.Field>
              <label>{t("login.password")}</label>
              <Form.Input
                icon="lock"
                type="password"
                placeholder={t("login.passwordplaceholder")}
                name="password"
                value={form.password}
                onChange={(e, { value }) => setForm(ps => ({ ...ps, password: value }))}
              />
              <Divider />
              <Form.Button fluid color="blue" content="Log in" />

              {siteSettings.allow_registration && (
                <div>
                  <Divider />
                  <Button
                    disabled={!siteSettings.allow_registration || isLoading || validateSignInForm(form)}
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
}
