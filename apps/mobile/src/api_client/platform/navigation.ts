import { navigateAndSimpleReset } from '../../Navigators/Root'

export const platformNavigation = {
  navigateToHome(): void {
    navigateAndSimpleReset('Main')
  },

  navigateToLogin(): void {
    navigateAndSimpleReset('Login')
  },

  // React Native doesn't have URL-based routing, so these always return false
  isPublicPage(): boolean {
    return false
  },

  isLoginPage(): boolean {
    return false
  },

  isSignupPage(): boolean {
    return false
  },
}
