import React, {Component} from 'react'
import {Table} from 'semantic-ui-react'
import { connect } from "react-redux";

export class ImageInfoTable extends Component {
	render() {
		var photo = {
    "exif_gps_lat": 48.5200277777778,
    "exif_gps_lon": 9.05576666666667,
    "exif_timestamp": "2013-09-06T17:42:15Z",
    "search_captions": "a mountain in the background , clouds in the sky , a building in the background , a red brick building , a mountain in the distance , red brick building with windows , trees on the hill , a large group of people , red brick building with roof , a building in the distance",
    "search_location": "Germany Baden-Württemberg Georgsbrunnen Tübingen",
    "thumbnail_url": "/media/thumbnails/8a2c3c09e57a61ec0b94cb131cd27fdb.jpg",
    "thumbnail_height": 225,
    "thumbnail_width": 300,
    "square_thumbnail_url": "/media/square_thumbnails/8a2c3c09e57a61ec0b94cb131cd27fdb.jpg",
    "geolocation_json": {
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "gid": "openstreetmap:venue:node:1253903951",
                    "locality": "Tübingen",
                    "layer": "venue",
                    "label": "Georgsbrunnen, Tübingen, Germany",
                    "country_a": "DEU",
                    "macrocounty": "Tübingen",
                    "country": "Germany",
                    "country_gid": "whosonfirst:country:85633111",
                    "name": "Georgsbrunnen",
                    "confidence": 0.8,
                    "region": "Baden-Württemberg",
                    "id": "node:1253903951",
                    "distance": 0.033,
                    "county_gid": "whosonfirst:county:102063305",
                    "macrocounty_gid": "whosonfirst:macrocounty:404227573",
                    "region_gid": "whosonfirst:region:85682567",
                    "accuracy": "point",
                    "source": "openstreetmap",
                    "locality_gid": "whosonfirst:locality:101748493",
                    "county": "Tübingen",
                    "source_id": "node:1253903951"
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        9.055688,
                        48.520321
                    ]
                }
            }
        ],
        "bbox": [
            9.055688,
            48.520321,
            9.055688,
            48.520321
        ],
        "search_text": "Germany Baden-Württemberg Georgsbrunnen Tübingen",
        "geocoding": {
            "timestamp": 1501811993088,
            "engine": {
                "author": "Mapzen",
                "name": "Pelias",
                "version": "1.0"
            },
            "attribution": "http://pelias.mapzen.com/v1/attribution",
            "query": {
                "point.lon": 9.055767,
                "lang": {
                    "defaulted": false,
                    "iso6391": "en",
                    "name": "English",
                    "iso6393": "eng"
                },
                "private": false,
                "boundary.circle.lon": 9.055767,
                "boundary.circle.lat": 48.520028,
                "boundary.circle.radius": 1,
                "querySize": 20,
                "size": 1,
                "point.lat": 48.520028
            },
            "version": "0.2"
        },
        "type": "FeatureCollection"
    },
    "exif_json": {
        "Interoperability InteroperabilityVersion": "[48, 49, 48, 48]",
        "EXIF SubSecTimeOriginal": "635",
        "EXIF ExifImageWidth": "2048",
        "GPS GPSLatitude": "[48, 31, 121/10]",
        "GPS GPSLongitude": "[9, 3, 519/25]",
        "EXIF ShutterSpeedValue": "6677/630",
        "GPS GPSImgDirectionRef": "M",
        "EXIF LensMake": "Apple",
        "EXIF FlashPixVersion": "0100",
        "EXIF BrightnessValue": "5589/607",
        "EXIF ColorSpace": "sRGB",
        "EXIF ComponentsConfiguration": "YCbCr",
        "GPS GPSVersionID": "[2, 2, 0, 0]",
        "EXIF ExposureProgram": "Program Normal",
        "EXIF FNumber": "12/5",
        "Image Make": "Apple",
        "GPS GPSLatitudeRef": "N",
        "Image ResolutionUnit": "Pixels/Inch",
        "Thumbnail Compression": "JPEG (old-style)",
        "Thumbnail JPEGInterchangeFormatLength": "5605",
        "Thumbnail XResolution": "72",
        "Image GPSInfo": "1014",
        "Image DateTime": "2013:09:06 17:42:15",
        "Thumbnail ResolutionUnit": "Pixels/Inch",
        "EXIF SceneCaptureType": "Standard",
        "EXIF LensModel": "iPhone 5 back camera 4.12mm f/2.4",
        "Image YResolution": "72",
        "EXIF ExposureTime": "1/1550",
        "Image ExifOffset": "210",
        "EXIF LensSpecification": "[103/25, 103/25, 12/5, 12/5]",
        "EXIF WhiteBalance": "Auto",
        "EXIF SensingMethod": "One-chip color area",
        "Interoperability InteroperabilityIndex": "R98",
        "EXIF SceneType": "Directly Photographed",
        "EXIF InteroperabilityOffset": "1252",
        "EXIF DateTimeDigitized": "2013:09:06 17:42:15",
        "EXIF CustomRendered": "2",
        "GPS GPSDate": "2013:09:06",
        "Image Software": "Google+ iOS 4.5.1.23341",
        "EXIF MeteringMode": "Pattern",
        "Thumbnail JPEGInterchangeFormat": "1376",
        "EXIF FocalLengthIn35mmFilm": "33",
        "EXIF FocalLength": "103/25",
        "EXIF ApertureValue": "4845/1918",
        "EXIF Flash": "Flash did not fire",
        "EXIF ImageUniqueID": "0eb8b6dc8883ff570000000000000000",
        "EXIF ExposureMode": "Auto Exposure",
        "EXIF ExifVersion": "0221",
        "GPS GPSImgDirection": "37397/146",
        "EXIF ISOSpeedRatings": "50",
        "GPS GPSAltitudeRef": "0",
        "GPS GPSTimeStamp": "[15, 42, 14]",
        "EXIF ExifImageLength": "1536",
        "GPS GPSLongitudeRef": "E",
        "Image Orientation": "Horizontal (normal)",
        "EXIF DateTimeOriginal": "2013:09:06 17:42:15",
        "EXIF SubSecTimeDigitized": "635",
        "Image XResolution": "72",
        "Image Model": "iPhone 5",
        "GPS GPSAltitude": "105258/281",
        "Thumbnail YResolution": "72"
    },
    "image_url": "/media/photos/8a2c3c09e57a61ec0b94cb131cd27fdb.jpg",
    "image_hash": "8a2c3c09e57a61ec0b94cb131cd27fdb",
    "image_path": "/home/rammi/Downloads/tuebingen/IMG_0312.JPG",
    "favorited": false
}


		if (photo.exif_json != null){
			var exif = photo.exif_json
		}
		else {
			var exif = {}
		}
		if (photo.geolocation_json != null){
			var geolocation = photo.geolocation_json.features[0].properties
		}
		else {
			var geolocation = {}
		}

		return (
			<div style={{width:'200px'}}>
			<Table compact='very' color='black' inverted>
				<Table.Body>
					<Table.Row>
						<Table.Cell>Width</Table.Cell>
						<Table.Cell>{exif['EXIF ExifImageWidth']}</Table.Cell>
					</Table.Row>
					<Table.Row>
						<Table.Cell>Length</Table.Cell>
						<Table.Cell>{exif['EXIF ExifImageLength']}</Table.Cell>
					</Table.Row>
					<Table.Row>
						<Table.Cell>Aperture</Table.Cell>
						<Table.Cell>{exif['EXIF ApertureValue']}</Table.Cell>
					</Table.Row>
					<Table.Row>
						<Table.Cell>Exposure</Table.Cell>
						<Table.Cell>{exif['EXIF ExposureTime']}</Table.Cell>
					</Table.Row>
					<Table.Row>
						<Table.Cell>Shutter Speed</Table.Cell>
						<Table.Cell>{exif['EXIF ShutterSpeedValue']}</Table.Cell>
					</Table.Row>
					<Table.Row>
						<Table.Cell>Lens</Table.Cell>
						<Table.Cell>{exif['EXIF LensModel']}</Table.Cell>
					</Table.Row>
					<Table.Row>
						<Table.Cell>Camera</Table.Cell>
						<Table.Cell>{exif['Image Model']}</Table.Cell>
					</Table.Row>
					<Table.Row>
						<Table.Cell>Time Taken</Table.Cell>
						<Table.Cell>{exif['EXIF DateTimeOriginal']}</Table.Cell>
					</Table.Row>
					<Table.Row>
						<Table.Cell>Location</Table.Cell>
						<Table.Cell>{geolocation['label']}</Table.Cell>
					</Table.Row>
				</Table.Body>
			</Table>
			</div>
		)			
	}
}