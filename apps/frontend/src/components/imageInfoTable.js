import React, { Component } from 'react'
import { Table, Header, Divider, Rating, Grid, List } from 'semantic-ui-react'
import { connect } from "react-redux";
import { LocationMap } from "./maps"

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

        if (photo.geolocation_json.features != undefined && photo.geolocation_json.features.length > 0){
            var geolocation = photo.search_location
		}
		else {
			var geolocation = 'No location information'
		}

        if (photo.people != null && Object.keys(photo.people).length > 0){
            var people = photo.people
        }
        else {
            var people = ["Could not find faces."]
        }

        if (photo.search_captions != null) {
            var captions = photo.search_captions.split(",").map((caption)=><List.Item>{caption}</List.Item>)
        } 
        else {
            var captions = null
        }

		return (
            <div>

                <div style={{padding:10}}>
                    <Header inverted as='h3'>Map</Header>
                    <LocationMap photos={[photo]}/>
                </div>

                <div style={{padding:10}}>
                    <Grid stackable columns={3} divided>
                        <Grid.Row>
                        <Grid.Column>
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
                        </Grid.Column>
                        <Grid.Column>
                            <Header inverted as='h3'>Captions</Header>
                            <List>
                            {captions}
                            </List>
                        </Grid.Column>
                        <Grid.Column>
                            <Header inverted as='h3'>People</Header>
                            <List>
                            {photo.people.map((person)=><List.Item>{person}</List.Item>)}
                            </List>
                        </Grid.Column>
                        </Grid.Row>
                    </Grid>
                </div>
            </div>
		)			
	}
}