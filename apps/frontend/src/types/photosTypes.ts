export interface PhotoSerializer {
  exif_gps_lat?: number | null;
  exif_gps_lon?: number | null;
  exif_timestamp?: string | null;
  search_captions?: string | null;
  search_location?: string | null;
  captions_json?: any;
  thumbnail_url?: string;
  thumbnail_height?: number;
  thumbnail_width?: number;
  small_thumbnail_url?: string;
  big_thumbnail_url?: string;
  square_thumbnail_url?: string;
  big_square_thumbnail_url?: string;
  small_square_thumbnail_url?: string;
  tiny_square_thumbnail_url?: string;
  geolocation_json?: any | null;
  exif_json?: any | null;
  people?: any;
  image_url?: string;
  image_hash: string;
  image_path?: string;
  rating: number;
  hidden?: boolean;
  public?: boolean;
  shared_to?: any[];
  similar_photos?: any;
  video?: boolean;
}

export interface SimpleUserSerializer {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
}

export interface PigPhotoSerializer {
  id: string;
  dominantColor: string;
  url: string;
  location: string;
  date: Date;
  birthTime: string;
  aspectRatio: number;
  type: "image" | "video";
  rating: number;
  owner: SimpleUserSerializer;
  shared_to: SimpleUserSerializer[];
}

export interface GroupedPhotosSerializer {
  date: Date;
  location: string;
  items: PigPhotoSerializer[];
}

export interface PhotosGroupedByUser {
  userId: string;
  photos: PigPhotoSerializer[];
}

export interface PigAlbumDateSerializer extends GroupedPhotosSerializer {
  id: string;
  date: Date;
  location: string;
  numberOfItems: number;
  incomplete: boolean;
  items: PigPhotoSerializer[];
}
