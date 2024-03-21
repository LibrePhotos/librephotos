Feature: Login

  Scenario: Login as admin
    Given I navigate to login page
    When I enter "admin" to username field
    And I enter "admin" to password field
    And I click Login button
    Then I should be on photo list page
