Feature: User Settings

  Scenario: Successfully update settings
    Given I am logged in as admin
    And user has default settings
    And I navigate to user settings
    When I change properties to:
      | Scene Confidence                              | Low             |
      | Semantic Search Max Results                   | Top 50          |
      | Synchronize metadata to disk                  | Save to sidecar |
      | Minimum image rating to interpret as favorite | 5               |
      | Default timezone                              | US/Pacific      |
      | Inferred faces confidence                     | 0.96            |
      | Always transcode videos                       | on              |
    And I save changes
    Then I should see update success notification
    And properties should be:
      | Scene Confidence                              | 0.05            |
      | Semantic Search Max Results                   | 50              |
      | Synchronize metadata to disk                  | SIDECAR_FILE    |
      | Minimum image rating to interpret as favorite | 5               |
      | Default timezone                              | US/Pacific      |
      | Inferred faces confidence                     | 0.96            |
      | Always transcode videos                       | on              |

  Scenario: Revert settings to defaults when canceled
    Given I am logged in as admin
    And user has default settings
    And I navigate to user settings
    When I change properties to:
      | Scene Confidence                              | Low             |
      | Semantic Search Max Results                   | Top 50          |
      | Synchronize metadata to disk                  | Save to sidecar |
      | Minimum image rating to interpret as favorite | 5               |
      | Default timezone                              | US/Pacific      |
      | Inferred faces confidence                     | 0.96            |
      | Always transcode videos                       | on              |
    And I cancel saving changes
    Then properties should be:
      | Scene Confidence                              | 0.1             |
      | Semantic Search Max Results                   | 0               |
      | Synchronize metadata to disk                  | OFF             |
      | Minimum image rating to interpret as favorite | 4               |
      | Default timezone                              | UTC             |
      | Inferred faces confidence                     | 0.90            |
      | Always transcode videos                       | off             |
