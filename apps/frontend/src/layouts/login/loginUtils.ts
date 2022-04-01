import { isStringEmpty } from "../../util/stringUtils";

export interface ISignUpFormState {
  username: string;
  password: string;
  firstname: string;
  lastname: string;
  passwordConfirm: string;
  email: string;
}

export interface ISignInFormState {
  username: string;
  password: string;
}

export function validateSignUpForm(form: ISignUpFormState): boolean {
  return (
    isStringEmpty(form.username) &&
    isStringEmpty(form.password) &&
    isStringEmpty(form.firstname) &&
    isStringEmpty(form.lastname) &&
    isStringEmpty(form.passwordConfirm) &&
    isStringEmpty(form.email) &&
    form.password === form.passwordConfirm
  );
}

export function validateSignInForm(form: ISignInFormState): boolean {
  return isStringEmpty(form.username) && isStringEmpty(form.password);
}
