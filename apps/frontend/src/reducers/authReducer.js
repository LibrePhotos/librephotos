// import jwtDecode from "jwt-decode";
// import * as auth from "../actions/authActions";
//
// const initialState = {
//   access: undefined,
//   refresh: undefined,
//   errors: {},
// };
//
// export default (state = initialState, action) => {
//   switch (action.type) {
//     case "LOGOUT":
//       return {
//         access: undefined,
//         refresh: undefined,
//         errors: {},
//       };
//     case "LOGIN_FULFILLED":
//       return {
//         access: {
//           token: action.payload.access,
//           ...jwtDecode(action.payload.access),
//         },
//         refresh: {
//           token: action.payload.refresh,
//           ...jwtDecode(action.payload.refresh),
//         },
//         errors: {},
//       };
//     case "LOGIN_REJECTED":
//       return {
//         ...state,
//         errors: action.payload.response,
//       };
//     case "SIGNUP_FULFILLED":
//       return {
//         ...state,
//         errors: {},
//       };
//     case "SIGNUP_REJECTED":
//       return {
//         ...state,
//         errors: action.payload.response,
//       };
//     case "REFRESH_ACCESS_TOKEN_FULFILLED":
//       return {
//         ...state,
//         access: {
//           token: action.payload.access,
//           ...jwtDecode(action.payload.access),
//         },
//         errors: {},
//       };
//
//     case auth.LOGIN_SUCCESS:
//       return {
//         access: {
//           token: action.payload.access,
//           ...jwtDecode(action.payload.access),
//         },
//         refresh: {
//           token: action.payload.refresh,
//           ...jwtDecode(action.payload.refresh),
//         },
//         errors: {},
//       };
//     case auth.TOKEN_RECEIVED:
//       return {
//         ...state,
//         access: {
//           token: action.payload.access,
//           ...jwtDecode(action.payload.access),
//         },
//       };
//     case auth.LOGIN_FAILURE:
//     case auth.TOKEN_FAILURE:
//       return {
//         access: undefined,
//         refresh: undefined,
//         errors: action.payload.response || {
//           non_field_errors: action.payload.statusText,
//         },
//       };
//
//     default:
//       return state;
//   }
// };

// import {isAccessTokenExpired} from "../store/auth/authSelectors";
//
// export function isRefreshTokenExpired(state) {
//   if (state.refresh && state.refresh.exp) {
//     return 1000 * state.refresh.exp - new Date().getTime() < 5000;
//   }
//   return true;
// }
//
// export function selectIsAuthenticated(state) {
//   // return true
//   return !isAccessTokenExpired(state);
// }
//
// export function errors(state) {
//   return state.errors;
// }
