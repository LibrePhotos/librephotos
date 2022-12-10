Feature: Login

  Background:
    When I open the application
    Then I am on login screen

  Scenario: Login as admin
    When I enter "admin" to username field
    And I enter "admin" to password field
    And I click "Login" button
    Then I should be on photo list page
