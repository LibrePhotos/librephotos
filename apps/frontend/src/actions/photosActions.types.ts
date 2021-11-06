import * as Yup from "yup";

export const SimpleUserSchema = Yup.object({
  id: Yup.number().required(),
  username: Yup.string().required(),
  first_name: Yup.string().defined(),
  last_name: Yup.string().defined(),
})
export interface SimpleUser extends Yup.Asserts<typeof SimpleUserSchema> { }

enum MediaType {
  IMAGE = "image",
  VIDEO = "video",
}

export const PigPhotoSchema = Yup.object({
  id: Yup.string().required(),
  dominantColor: Yup.string().default(undefined),
  url: Yup.string().default(undefined),
  location: Yup.string().default(undefined),
  date: Yup.string().default(undefined).nullable(),
  birthTime: Yup.string().default(undefined),
  aspectRatio: Yup.number().required(),
  type: Yup.mixed<MediaType>().oneOf(Object.values(MediaType)).default(MediaType.IMAGE),
  rating: Yup.number().default(0),
  owner: SimpleUserSchema.default(undefined),
  shared_to: Yup.array().of(SimpleUserSchema).default([]),
  isTemp: Yup.boolean().default(false),
})
export interface PigPhoto extends Yup.Asserts<typeof PigPhotoSchema> { }

export const SharedFromMePhotoSchema = Yup.object({
  user_id: Yup.number().required(),
  user: SimpleUserSchema.required(),
  photo: PigPhotoSchema.required(),
})

export const PhotoHashSchema = Yup.object({
  image_hash: Yup.string().required(),
  video: Yup.boolean(),
})

export const PersonInfoSchema = Yup.object({
  id: Yup.string().required(),
  name: Yup.string().required(),
})
export interface PersonInfo extends Yup.Asserts<typeof PersonInfoSchema> { }

export const PhotoSchema = Yup.object({
  exif_gps_lat: Yup.number().transform((value) => (isNaN(value) ? undefined : value)),
  exif_gps_lon: Yup.number().transform((value) => (isNaN(value) ? undefined : value)),
  exif_timestamp: Yup.string(),
  search_captions: Yup.string(),
  search_location: Yup.string().nullable(),
  captions_json: Yup.object().nullable(),
  thumbnail_url: Yup.string().nullable(),
  thumbnail_height: Yup.number().transform((value) => (isNaN(value) ? undefined : value)),
  thumbnail_width: Yup.number().transform((value) => (isNaN(value) ? undefined : value)),
  small_thumbnail_url: Yup.string().nullable(),
  big_thumbnail_url: Yup.string().nullable(),
  square_thumbnail_url: Yup.string().nullable(),
  big_square_thumbnail_url: Yup.string().nullable(),
  small_square_thumbnail_url: Yup.string().nullable(),
  tiny_square_thumbnail_url: Yup.string().nullable(),
  geolocation_json: Yup.object().nullable(),
  exif_json: Yup.object().nullable(),
  people: Yup.array().of(Yup.string()),
  image_url: Yup.string().nullable(),
  image_hash: Yup.string().required(),
  image_path: Yup.string(),
  rating: Yup.number().required(),
  hidden: Yup.boolean(),
  public: Yup.boolean(),
  shared_to: Yup.array().of(SimpleUserSchema.nullable()),  // TODO: There are sometimes items in the array with value null. Why?!?
  similar_photos: Yup.array().of(PhotoHashSchema),
  video: Yup.boolean(),
})
export interface Photo extends Yup.Asserts<typeof PhotoSchema> { }

export const PhotoSuperSimpleSchema = Yup.object({
  image_hash: Yup.string().required(),
  rating: Yup.number().required(),
  hidden: Yup.boolean().required(),
  exif_timestamp: Yup.date().required(),
  public: Yup.boolean().required(),
  video: Yup.boolean().required(),
})
export interface PhotoSuperSimple extends Yup.Asserts<typeof PhotoSuperSimpleSchema> { }

export const DatePhotosGroupSchema = Yup.object({
  date: Yup.string().required(),
  location: Yup.string().nullable(),
  items: Yup.array().of(PigPhotoSchema).required(),
})
export interface DatePhotosGroup extends Yup.Asserts<typeof DatePhotosGroupSchema> { }

export const IncompleteDatePhotosGroupSchema = DatePhotosGroupSchema.shape({
  id: Yup.string().required(),
  incomplete: Yup.boolean().required(),
  numberOfItems: Yup.number().required(),
})
export interface IncompleteDatePhotosGroup extends Yup.Asserts<typeof IncompleteDatePhotosGroupSchema> { }
