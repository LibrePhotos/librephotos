import networkx as nx
from api.models import Person, Photo
import itertools


def build_social_graph():
	G = nx.Graph()

	people = Person.objects.all()
	for person in people:
		person = Person.objects.prefetch_related('faces__photo__faces__person').filter(id=person.id)[0]
		for this_person_face in person.faces.all():
			for other_person_face in this_person_face.photo.faces.all():
				G.add_edge(person.name,other_person_face.person.name)
	nodes = [{'id':node} for node in G.nodes()]
	links = [{'source':pair[0], 'target':pair[1]} for pair in G.edges()]
	res = {"nodes":nodes, "links":links}
	return res

def build_ego_graph(person_id):
	G = nx.Graph()
	person = Person.objects.prefetch_related('faces__photo__faces__person').filter(id=person_id)[0]
	for this_person_face in person.faces.all():
		for other_person_face in this_person_face.photo.faces.all():
			G.add_edge(person.name,other_person_face.person.name)
	nodes = [{'id':node} for node in G.nodes()]
	links = [{'source':pair[0], 'target':pair[1]} for pair in G.edges()]
	res = {"nodes":nodes, "links":links}
	return res