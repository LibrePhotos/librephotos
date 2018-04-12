import React, {Component} from 'react'
import {Table, Header, Divider, Rating} from 'semantic-ui-react'
import { connect } from "react-redux";
import {LocationMap} from "./maps"

export class ImageInfoTable extends Component {
	render() {
        var photo = this.props.photo
        console.log(photo)
        if (photo.exif_json != null){
            var exif = photo.exif_json
        }
        else {
            var exif = {}
        }
        if (photo.geolocation_json != null && Object.keys(photo.geolocation_json).length > 0){
			var geolocation = photo.geolocation_json.features[1].place_name
		}
		else {
			var geolocation = ''
		}
        console.log(geolocation)

		return (
            <div>
                <Header inverted as='h3'>EXIF Information</Header>
                <Table basic inverted compact='very' celled striped>
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
                            <Table.Cell>{geolocation}</Table.Cell>
                        </Table.Row>
                    </Table.Body>
                </Table>
                <Header inverted as='h3'>Captions</Header>
                {photo.search_captions}
                <Divider hidden/>
                <Header inverted as='h3'>Map</Header>
                <LocationMap photos={[photo]}/>
                <Divider hidden/>

            </div>
		)			
	}
}