import networkx as nx
from api.models import Person, Photo
import itertools


def build_social_graph():
	G = nx.Graph()

	people = Person.objects.all()
	person_names = [person.name for person in people]

	photos = Photo.objects.all()

	G.add_nodes_from(person_names)

	name_sets = []
	for photo in photos:
		names = []
		for face in photo.faces.all(): 
			names.append(face.person.name)
		names = list(set(names))
		if len(names) > 0:
			name_sets.append(names)

	for name_set in name_sets:
		pairs = list(itertools.combinations(name_set, 2))
		for pair in pairs:
			G.add_edge(pair[0],pair[1])


	nodes = [{'id':node} for node in G.nodes()]
	links = [{'source':pair[0], 'target':pair[1]} for pair in G.edges()]
	res = {"nodes":nodes, "links":links}
	return res
