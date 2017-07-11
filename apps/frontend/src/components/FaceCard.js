import React, { Component } from 'react';
import { Image, Dropdown, Divider , Card } from 'semantic-ui-react';
import { connect } from "react-redux";
import { fetchPeople } from '../actions/peopleActions';

export class FaceCards extends Component {
	componentWillMount() {
		this.props.dispatch(fetchPeople())
	}

	render() {
		var peopleDropdownChoices = this.props.people.map(function(person){
			return (
				{key:person.id,value:person.id,text:person.name}
			)
		})
		var mappedFaceCards = this.props.people.map(function(person){
			return (
				<FaceCard
					key={person.id}
					name={person.name}
					face_url={person.face_url}
					people={peopleDropdownChoices}/>
			)
		})
		console.log(this.props)
		return (
			<Card.Group>
				{mappedFaceCards}
			</Card.Group>
		)
	}
}



export class FaceCard extends Component {
	render() {
		console.log(this.props)
		return (
			<Card>
				<Card.Content>
					<Image 
						size='medium'
						shape='rounded'
						src={this.props.face_url} />
					<Card.Header>
						<Divider/>
						{this.props.name}
					</Card.Header>
					<Card.Description>
						{"Who is this person?"}
					</Card.Description>
		    </Card.Content>
      	<Card.Content extra>
					<Dropdown 
						fluid 
						placeholder='Choose a Person' 
						search 
						selection 
						options={this.props.people} />	
				</Card.Content>
			</Card>
		);
	}
}

FaceCards = connect((store)=>{
	return {
		people: store.people.people,
		userFetched:store.people.fetched
	}
})(FaceCards)

export default connect()(FaceCards)
