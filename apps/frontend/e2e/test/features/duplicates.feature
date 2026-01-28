Feature: Duplicates Management

  Background:
    Given I am logged in as admin

  Scenario: Navigate to duplicates page
    When I navigate to organizing page
    Then I should see the duplicates tab active
    And I should see "Find Duplicates" button

  Scenario: Trigger duplicate detection
    Given I navigate to organizing page
    When I click "Find Duplicates" button
    Then I should see detection in progress
    And detection should complete successfully

  Scenario: Filter duplicates by status
    Given I navigate to organizing page
    And there are pending duplicates in the system
    When I filter by "pending" status
    Then I should only see pending duplicates
    When I filter by "resolved" status
    Then I should only see resolved duplicates
    When I filter by "all" status
    Then I should see all duplicates

  Scenario: Filter duplicates by type
    Given I navigate to organizing page
    And there are duplicates of different types
    When I filter by "Exact Copies" type
    Then I should only see exact copy duplicates
    When I filter by "Visual Duplicates" type
    Then I should only see visual duplicates

  Scenario: Open duplicate detail modal
    Given I navigate to organizing page
    And there is at least one pending duplicate
    When I click on a duplicate card
    Then I should see the duplicate detail modal
    And I should see multiple photos in the modal
    And I should see resolution and file size info

  Scenario: Resolve duplicate by keeping selected photo
    Given I navigate to organizing page
    And there is at least one pending duplicate
    When I click on a duplicate card
    And I select a photo to keep
    And I click "Keep Selected & Trash Others" button
    Then the duplicate should be marked as resolved
    And the modal should close

  Scenario: Dismiss duplicate as not a duplicate
    Given I navigate to organizing page
    And there is at least one pending duplicate
    When I click on a duplicate card
    And I click "Not a Duplicate" button
    Then the duplicate should be marked as dismissed
    And the modal should close

  Scenario: Revert resolved duplicate
    Given I navigate to organizing page
    And there is at least one resolved duplicate
    When I filter by "resolved" status
    And I click on a resolved duplicate card
    Then I should see the "Revert & Restore Photos" button
    When I click "Revert & Restore Photos" button
    Then the duplicate should be back to pending status

  Scenario: Select multiple duplicates for bulk action
    Given I navigate to organizing page
    And there are multiple pending duplicates
    When I check the "Select All" checkbox
    Then all visible duplicates should be selected
    When I click "Delete Selected" button
    Then the selected duplicates should be removed

  Scenario: View photo in lightbox from duplicate modal
    Given I navigate to organizing page
    And there is at least one pending duplicate
    When I click on a duplicate card
    And I click the expand button on a photo
    Then I should see the photo in full size lightbox

  Scenario: Detection options are applied
    Given I navigate to organizing page
    When I open detection options menu
    And I uncheck "Exact file copies" option
    And I check "Visual duplicates" option
    And I select "Strict" sensitivity
    And I click "Find Duplicates" button
    Then detection should run with selected options
