import { IApiLoginPost, IApiLoginResponse, UserSignupRequest, UserSignupResponse } from "../../store/auth/auth.zod";
import { ApiLoginResponseSchema, UserSignupResponseSchema } from "../../store/auth/auth.zod";

export type SignUpMutationVariables = UserSignupRequest;
export type SignUpMutationResponse = UserSignupResponse;

export type LoginMutationVariables = IApiLoginPost;
export type LoginMutationResponse = IApiLoginResponse;

export type LogoutMutationVariables = void;
export type LogoutMutationResponse = void; 