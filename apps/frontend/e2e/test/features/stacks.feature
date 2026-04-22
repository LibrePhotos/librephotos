Feature: Stacks Management

  Background:
    Given I am logged in as admin

  Scenario: Navigate to stacks tab
    When I navigate to organizing page
    And I click on the Stacks tab
    Then I should see the stacks list
    And I should see "Detect Stacks" button

  Scenario: Trigger stack detection
    Given I navigate to organizing page
    And I click on the Stacks tab
    When I click "Detect Stacks" button
    Then I should see stack detection in progress
    And stack detection should complete successfully

  Scenario: Filter stacks by type
    Given I navigate to organizing page
    And I click on the Stacks tab
    And there are stacks of different types
    When I filter by "RAW+JPEG" type
    Then I should only see RAW+JPEG stacks
    When I filter by "Burst" type
    Then I should only see burst stacks
    When I filter by "All Types" type
    Then I should see all stacks

  Scenario: Open stack detail modal
    Given I navigate to organizing page
    And I click on the Stacks tab
    And there is at least one stack
    When I click on a stack card
    Then I should see the stack detail modal
    And I should see photos in the stack
    And I should see the primary photo highlighted

  Scenario: Set primary photo in stack
    Given I navigate to organizing page
    And I click on the Stacks tab
    And there is at least one stack with multiple photos
    When I click on a stack card
    And I select a different photo as primary
    Then the selected photo should become primary
    And the stack cover should update

  Scenario: Unstack photos
    Given I navigate to organizing page
    And I click on the Stacks tab
    And there is at least one stack
    When I click the context menu on a stack card
    And I click "Unstack" option
    Then the stack should be removed
    And photos should no longer be grouped

  Scenario: View stack photos in lightbox
    Given I navigate to organizing page
    And I click on the Stacks tab
    And there is at least one stack
    When I click on a stack card
    And I click the expand button on a photo
    Then I should see the photo in full size lightbox
    And I should be able to navigate between stack photos
