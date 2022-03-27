import React, { useState } from "react";
import { Image, Header, Divider, Message, Segment, Button, Form } from "semantic-ui-react";
import { signup } from "../../actions/authActions";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { useTranslation } from "react-i18next";
import { authErrors } from "../../store/auth/authSelectors";

export const SignupPage = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const errors = useAppSelector((state) => authErrors(state));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [firstname, setFirstname] = useState("");
  const [lastname, setLastname] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [email, setEmail] = useState("");
  console.log(errors);
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
          <Image src={"/logo.png"} size="tiny" verticalAlign="middle" />
          <span style={{ paddingLeft: 5, fontSize: 18 }}>
            {" "}
            <b>LibrePhotos</b>
          </span>
        </div>
        <Segment attached>
          <Header>{t("login.signup")}</Header>
          <Form>
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
              <label>{t("settings.email")}</label>
              <Form.Input
                icon="mail"
                placeholder={t("settings.emailplaceholder")}
                name="email"
                value={email}
                onChange={(e, { name, value }) => setEmail(value)}
              />
            </Form.Field>
            <Form.Field>
              <label>{t("settings.firstname")}</label>
              <Form.Input
                placeholder={t("settings.firstnameplaceholder")}
                name="firstname"
                value={firstname}
                onChange={(e, { name, value }) => setFirstname(value)}
              />
            </Form.Field>
            <Form.Field>
              <label>{t("settings.lastname")}</label>
              <Form.Input
                placeholder={t("settings.lastnameplaceholder")}
                name="lastname"
                value={lastname}
                onChange={(e, { name, value }) => setLastname(value)}
              />
            </Form.Field>
            <Form.Field>
              <label>{t("login.password")}</label>
              <Form.Input
                error={passwordConfirm.length > 0 && password !== passwordConfirm}
                icon="lock"
                type="password"
                placeholder={t("login.passwordplaceholder")}
                name="password"
                value={password}
                onChange={(e, { name, value }) => setPassword(value)}
              />
              <label>{t("login.confirmpassword")}</label>
              <Form.Input
                error={passwordConfirm.length > 0 && password !== passwordConfirm}
                icon="lock"
                type="password"
                placeholder={t("login.confirmpasswordplaceholder")}
                name="passwordConfirm"
                value={passwordConfirm}
                onChange={(e, { name, value }) => setPasswordConfirm(value)}
              />
              <Divider />
            </Form.Field>
            <Button
              onClick={() => {
                signup(username.toLowerCase(), password, email, firstname, lastname, false, dispatch);
              }}
              disabled={password.length === 0 || password !== passwordConfirm}
              fluid
              color="blue"
            >
              {t("login.signup")}
            </Button>
          </Form>
        </Segment>
        {errors && errors.data && errors.data.detail && (
          <Message color="red" secondary attached>
            <p>{errors.data.detail}</p>
          </Message>
        )}
        {errors && errors.non_field_errors && (
          <Message color="red" secondary attached>
            {errors.non_field_errors}
          </Message>
        )}
        {errors && errors.data && errors.data.password && (
          <Message color="red" secondary attached>
            {t("login.errorpassword")}
          </Message>
        )}
        {errors && errors.data && errors.data.username && (
          <Message color="red" secondary attached="bottom">
            {errors.data.username[0].includes("already exists")
              ? t("login.errorusernameexists")
              : t("login.errorusername")}
          </Message>
        )}
        {errors && errors.data && errors.data.email && (
          <Message color="red" secondary attached="bottom">
            {t("login.erroremail")}
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
      />
    </div>
  );
};
