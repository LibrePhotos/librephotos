import networkx as nx
from api.models import Person, Photo
import itertools
from django.db.models import Count


def build_social_graph(user):
    #todo filter by user
    G = nx.Graph()


#     me = Person.objects.all().annotate(face_count=Count('faces')).order_by('-face_count').first()

    people = list(Person.objects.all().annotate(face_count=Count('faces')).order_by('-face_count'))[1:]
    for person in people:
#         if person.id == me.id:
#             continue
        person = Person.objects.prefetch_related('faces__photo__faces__person').filter(id=person.id)[0]
        for this_person_face in person.faces.all():
            for other_person_face in this_person_face.photo.faces.all():
#                 if other_person_face.person.id != me.id:
                G.add_edge(person.name,other_person_face.person.name)

    # pos = nx.kamada_kawai_layout(G,scale=1000)
    pos = nx.spring_layout(G,scale=1000,iterations=20)
    nodes = [{'id':node,'x':pos[0],'y':pos[1]} for node,pos in pos.items()]
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
