/**
 * Regression coverage for https://github.com/LibrePhotos/librephotos/issues/1888
 *
 * Since the #1861 authorization fix, GET /api/user/ returns the full
 * UserSerializer only to admins (and to a user viewing their own record).
 * Every other authenticated reader gets the public-safe PublicUserSerializer:
 *   id, avatar_url, username, first_name, last_name,
 *   public_photo_count, public_photo_samples (+ public_sharing).
 *
 * useFetchUserListQuery used to validate every row against the *full* `User`
 * schema, so non-admins got a flood of "Required at results.N.<field>" popups.
 * Admins never saw it because they receive the full payload. The fix validates
 * each row against the relaxed `ListUser` schema instead.
 *
 * This suite asserts directly against the `ListUser` / `ListUserList` schemas
 * (the source of truth the hook's `UserListResponse` wraps). Importing the hook
 * itself would drag the native `fetchClient` chain (token storage, navigation,
 * zustand stores) into jest, which is irrelevant to the parsing regression.
 */
import { ListUser, ListUserList, User } from '../types'

// What an authenticated NON-admin receives for each row (PublicUserSerializer).
const publicSafeUser = {
  id: 1,
  username: 'alice',
  first_name: 'Alice',
  last_name: 'Anderson',
  avatar_url: null,
  public_photo_count: 3,
  public_photo_samples: [],
  public_sharing: true,
}

// What an admin (or a user viewing their own record) receives (UserSerializer).
const fullUser = {
  ...publicSafeUser,
  email: 'alice@example.com',
  scan_directory: '/data/alice',
  confidence: 0.5,
  confidence_person: 0.9,
  transcode_videos: false,
  semantic_search_topk: 100,
  date_joined: '2023-01-01T00:00:00Z',
  avatar: null,
  photo_count: 42,
  nextcloud_server_address: null,
  nextcloud_username: null,
  nextcloud_scan_directory: null,
  favorite_min_rating: 0,
  image_scale: 1,
  save_metadata_to_disk: 'OFF',
  datetime_rules: '[]',
  default_timezone: 'UTC',
  face_recognition_model: 'mobilenet',
  confidence_unknown_face: 0.5,
  min_cluster_size: 2,
  min_samples: 1,
  cluster_selection_epsilon: 0.1,
  llm_settings: null,
}

describe('issue #1888 — non-admin user list popup', () => {
  test('documents the symptom: the full User schema rejects a public-safe row', () => {
    // This is what produced "Required at results.0.email; ...confidence; ..."
    const result = User.safeParse(publicSafeUser)
    expect(result.success).toBe(false)
    if (!result.success) {
      const missing = result.error.issues.map(i => i.path.join('.'))
      // The exact fields from the GitHub report (plus mobile-only required ones).
      expect(missing).toEqual(
        expect.arrayContaining([
          'email',
          'confidence',
          'confidence_person',
          'transcode_videos',
          'semantic_search_topk',
          'date_joined',
          'photo_count',
          'favorite_min_rating',
          'image_scale',
          'save_metadata_to_disk',
          'datetime_rules',
          'default_timezone',
          'face_recognition_model',
          'confidence_unknown_face',
          'min_cluster_size',
          'min_samples',
          'cluster_selection_epsilon',
        ]),
      )
    }
  })

  test('ListUser accepts the public-safe payload non-admins receive', () => {
    // Before the fix this threw a ZodError (the popup). After the fix it parses.
    expect(() => ListUser.parse(publicSafeUser)).not.toThrow()
    const parsed = ListUser.parse(publicSafeUser)
    expect(parsed.username).toBe('alice')
    // Private/admin-only fields are absent for non-admins.
    expect(parsed.email).toBeUndefined()
    expect(parsed.date_joined).toBeUndefined()
  })

  test('ListUserList accepts a list of public-safe rows', () => {
    expect(() => ListUserList.parse([publicSafeUser])).not.toThrow()
    const parsed = ListUserList.parse([publicSafeUser])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].username).toBe('alice')
  })

  test('ListUserList still accepts the full admin payload', () => {
    expect(() => ListUserList.parse([fullUser])).not.toThrow()
    const parsed = ListUserList.parse([fullUser])
    expect(parsed[0].email).toBe('alice@example.com')
  })
})
