import React, { useEffect, useState } from "react";
import { Button, Divider, Form, Header, Image, Segment } from "semantic-ui-react";
import { useTranslation } from "react-i18next";
import type {} from "../../api_client/api";
import { useHistory } from "react-router-dom";
import { useSignUpMutation } from "../../api_client/api";
import type { ISignUpFormState } from "./loginUtils";
import { validateSignUpForm } from "./loginUtils";
import type { IApiUserSignUpPost } from "../../store/auth/auth.zod";

export const initialFormState: ISignUpFormState = {
  username: "",
  password: "",
  firstname: "",
  lastname: "",
  passwordConfirm: "",
  email: "",
};

export function FirstTimeSetupPage(): JSX.Element {
  const { t } = useTranslation();
  const history = useHistory();
  const [signup, { isLoading, isSuccess }] = useSignUpMutation();
  const [form, setForm] = useState<ISignUpFormState>(initialFormState);

  function onClickSignUp(e: React.MouseEvent<HTMLButtonElement>): void {
    e.preventDefault();

    const { email, firstname, lastname, username, password } = form;
    const formApi: IApiUserSignUpPost = {
      email,
      firstname,
      lastname,
      username,
      password,
      is_superuser: true,
    };

    void signup(formApi);
  }

  useEffect(() => {
    if (isSuccess) {
      history.push("/");
    }
  }, [history, isSuccess]);

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
          <Image src="/logo.png" size="tiny" verticalAlign="middle" />
          <span style={{ paddingLeft: 5, fontSize: 18 }}>
            &nbsp;
            <b>LibrePhotos</b>
          </span>
        </div>
        <Segment attached>
          <Header>{t("login.firsttimesetup")}</Header>
          <Form>
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
              <label>{t("settings.email")}</label>
              <Form.Input
                icon="mail"
                placeholder={t("settings.emailplaceholder")}
                name="email"
                value={form.email}
                onChange={(e, { value }) => setForm(ps => ({ ...ps, email: value }))}
              />
            </Form.Field>
            <Form.Field>
              <label>{t("settings.firstname")}</label>
              <Form.Input
                placeholder={t("settings.firstnameplaceholder")}
                name="firstname"
                value={form.firstname}
                onChange={(e, { value }) => setForm(ps => ({ ...ps, firstname: value }))}
              />
            </Form.Field>
            <Form.Field>
              <label>{t("settings.lastname")}</label>
              <Form.Input
                placeholder={t("settings.lastnameplaceholder")}
                name="lastname"
                value={form.lastname}
                onChange={(e, { value }) => setForm(ps => ({ ...ps, lastname: value }))}
              />
            </Form.Field>
            <Form.Field>
              <label>{t("login.password")}</label>
              <Form.Input
                error={form.passwordConfirm.length > 0 && form.password !== form.passwordConfirm}
                icon="lock"
                type="password"
                placeholder={t("login.passwordplaceholder")}
                name="password"
                value={form.password}
                onChange={(e, { value }) => setForm(ps => ({ ...ps, password: value }))}
              />
              <label>{t("login.confirmpassword")}</label>
              <Form.Input
                error={form.passwordConfirm.length > 0 && form.password !== form.passwordConfirm}
                icon="lock"
                type="password"
                placeholder={t("login.confirmpasswordplaceholder")}
                name="passwordConfirm"
                value={form.passwordConfirm}
                onChange={(e, { value }) => setForm(ps => ({ ...ps, passwordConfirm: value }))}
              />
              <Divider />
            </Form.Field>
            <Button onClick={onClickSignUp} disabled={isLoading || validateSignUpForm(form)} fluid color="blue">
              {t("login.signup")}
            </Button>
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
      />
    </div>
  );
}
