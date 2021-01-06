from api.models import Photo, Face, Person, AlbumAuto, AlbumDate, AlbumUser, LongRunningJob
from api.serializers import LongRunningJobSerializer
import numpy as np

import os
import stat
from collections import Counter

from django.db.models.functions import TruncMonth
from django.db.models import Count, Q

import random
from datetime import date, datetime
from itertools import groupby

import seaborn as sns
import pandas as pd
from api.util import logger

def get_current_job():
    job_detail = None
    running_job = LongRunningJob.objects.filter(
        finished=False).order_by('-started_at').first()
    if running_job:
        job_detail = LongRunningJobSerializer(running_job).data
    return job_detail

def shuffle(l):
    random.shuffle(l)
    return l

def is_hidden(filepath):
    name = os.path.basename(os.path.abspath(filepath))
    return name.startswith('.') or has_hidden_attribute(filepath)

def has_hidden_attribute(filepath):
    try:
        return bool(os.stat(filepath).st_file_attributes & stat.FILE_ATTRIBUTE_HIDDEN)
    except:
        return False

def path_to_dict(path):
    d = {'title': os.path.basename(path), 'absolute_path': path}
    d['children'] = [
        path_to_dict(os.path.join(path, x)) for x in os.scandir(path)
        if os.path.isdir(os.path.join(path, x)) and not is_hidden(os.path.join(path, x))
    ]
    return d


def jump_by_month(start_date, end_date, month_step=1):
    current_date = start_date
    yield current_date
    while current_date < end_date:
        carry, new_month = divmod(current_date.month - 1 + month_step, 12)
        new_month += 1
        current_date = current_date.replace(
            year=current_date.year + carry, month=new_month)
        yield current_date


def get_location_timeline(user):
    qs_photos = Photo.objects.exclude(geolocation_json={}).exclude(
        exif_timestamp=None).filter(owner=user).order_by('exif_timestamp')
    photos = qs_photos.all()
    timestamp_loc = [(p.exif_timestamp,
                      p.geolocation_json['features'][-1]['text'])
                     for p in photos]

    groups = []
    uniquekeys = []
    for k, g in groupby(timestamp_loc, lambda x: x[1]):
        groups.append(list(g))  # Store group iterator as a list
        uniquekeys.append(k)

    city_start_end_duration = []
    for idx, group in enumerate(groups):
        city = group[0][1]
        start = group[0][0]
        if idx < len(groups) - 1:
            end = groups[idx + 1][0][0]
        else:
            end = group[-1][0]
        time_in_city = (end - start).total_seconds()

        if time_in_city > 0:
            city_start_end_duration.append([city, start, end, time_in_city])

    locs = list(set([e[0] for e in city_start_end_duration]))
    colors = sns.color_palette('Paired', len(locs)).as_hex()

    loc2color = dict(zip(locs, colors))

    intervals_in_seconds = []
    for idx, sted in enumerate(city_start_end_duration):
        intervals_in_seconds.append({
            'loc':
            sted[0],
            'start':
            sted[1].timestamp(),
            'end':
            sted[2].timestamp(),
            'dur':
            sted[2].timestamp() - sted[1].timestamp()
        })

    data = [{
        "data": [d['dur']],
        "color": loc2color[d['loc']],
        "loc": d['loc'],
        'start': d['start'],
        'end': d['end']
    } for d in intervals_in_seconds]
    return data


def get_search_term_examples(user):
    pp = Photo.objects.filter(owner=user).exclude(geolocation_json={}).exclude(
        exif_timestamp=None).exclude(
            captions_json={}).prefetch_related('faces__person')

    try:
        samples = random.sample(list(pp.all()), 100)
    except ValueError:
        return [
            'for people', 'for places', 'for things', 'for time',
            'for file path or file name'
        ]

    search_data = []
    for p in samples:
        faces = p.faces.all()

        terms_loc = [
            f['text'] for f in p.geolocation_json['features'][-5:]
            if not f['text'].isdigit()
        ]
        terms_time = [str(p.exif_timestamp.year)]
        terms_people = [f.person.name.split(' ')[0] for f in faces]
        terms_things = p.captions_json['places365'][
            'categories']

        terms = {
            "loc": terms_loc,
            "time": terms_time,
            "people": terms_people,
            "things": terms_things
        }

        search_data.append(terms)

        search_terms = []
        for datum in search_data:
            term_loc = random.choice(datum['loc'])
            search_terms.append(term_loc)

            term_time = random.choice(datum['time'])
            search_terms.append(term_time)

            term_thing = random.choice(datum['things'])

            if len(datum['people']) > 0:
                term_people = random.choice(datum['people'])
                search_terms.append(term_people)

                search_term_loc_people = ' '.join(
                    shuffle([term_loc, term_people]))
                if random.random() > 0.3:
                    search_terms.append(search_term_loc_people)

                search_term_time_people = ' '.join(
                    shuffle([term_time, term_people]))
                if random.random() > 0.3:
                    search_terms.append(search_term_time_people)

                search_term_people_thing = ' '.join(
                    shuffle([term_people, term_thing]))
                if random.random() > 0.9:
                    search_terms.append(search_term_people_thing)

                search_term_all = ' '.join(
                    shuffle([term_loc, term_people, term_time, term_thing]))
                if random.random() > 0.95:
                    search_terms.append(search_term_all)

            else:
                term_people = ''

            search_term_loc_time = ' '.join(shuffle([term_loc, term_time]))
            if random.random() > 0.3:
                search_terms.append(search_term_loc_time)

            search_term_loc_thing = ' '.join(shuffle([term_loc, term_thing]))
            if random.random() > 0.9:
                search_terms.append(search_term_loc_thing)

            search_term_time_thing = ' '.join(shuffle([term_time, term_thing]))
            if random.random() > 0.9:
                search_terms.append(search_term_time_thing)

    return list(set(search_terms))


def get_count_stats(user):
    num_photos = Photo.objects.filter(owner=user).count()
    num_faces = Face.objects.filter(photo__owner=user).count()
    num_unknown_faces = Face.objects.filter(
        Q(person__name__exact='unknown') & Q(photo__owner=user)).count()
    num_labeled_faces = Face.objects.filter(
        Q(person_label_is_inferred=False) & ~Q(person__name__exact='unknown') &
        Q(photo__owner=user)).count()
    num_inferred_faces = Face.objects.filter(
        Q(person_label_is_inferred=True) & Q(photo__owner=user)).count()
    num_people = Person.objects.count()
    num_albumauto = AlbumAuto.objects.filter(owner=user).count()
    num_albumdate = AlbumDate.objects.filter(owner=user).count()
    num_albumuser = AlbumUser.objects.filter(owner=user).count()

    res = {
        "num_photos": num_photos,
        "num_faces": num_faces,
        "num_people": num_people,
        "num_unknown_faces": num_unknown_faces,
        "num_labeled_faces": num_labeled_faces,
        "num_inferred_faces": num_inferred_faces,
        "num_albumauto": num_albumauto,
        "num_albumdate": num_albumdate,
        "num_albumuser": num_albumuser,
    }
    return res


def get_location_clusters(user):
    start = datetime.now()
    photos = Photo.objects.filter(owner=user).exclude(geolocation_json={})

    level = -3
    coord_names = []
    names = []
    for p in photos:
        for feature in p.geolocation_json['features']:
            names.append(feature['text'])
            if not feature['text'].isdigit():
                coord_names.append([feature['text'], feature['center']])

    groups = []
    uniquekeys = []
    coord_names.sort(key=lambda x: x[0])
    for k, g in groupby(coord_names, lambda x: x[0]):
        groups.append(list(g))  # Store group iterator as a list
        uniquekeys.append(k)

    res = [[g[0][1][1], g[0][1][0], g[0][0]] for g in groups]
    elapsed = (datetime.now() - start).total_seconds()
    logger.info('location clustering took %.2f seconds' % elapsed)
    return res


def get_photo_country_counts(user):
    photos_with_gps = Photo.objects.exclude(geolocation_json=None).filter(owner=user)
    geolocations = [p.geolocation_json for p in photos_with_gps]
    countries = []
    for gl in geolocations:
        if 'features' in gl.keys():
            for feature in gl['features']:
                if feature['place_type'][0] == 'country':
                    countries.append(feature['place_name'])

    counts = Counter(countries)
    return counts


def get_location_sunburst(user):
    photos_with_gps = Photo.objects.exclude(geolocation_json={}).exclude(
        geolocation_json=None).filter(owner=user)

    if photos_with_gps.count() == 0:
        return {'children':[]}

    geolocations = [p.geolocation_json for p in photos_with_gps]

    four_levels = []
    for gl in geolocations:
        out_dict = {}
        if 'features' in gl.keys():
            if len(gl['features']) >= 1:
                out_dict[1] = gl['features'][-1]['text']
            if len(gl['features']) >= 2:
                out_dict[2] = gl['features'][-2]['text']
            if len(gl['features']) >= 3:
                out_dict[3] = gl['features'][-3]['text']
            four_levels.append(out_dict)

    df = pd.DataFrame(four_levels)
    df = df.groupby(
        df.columns.tolist()).size().reset_index().rename(columns={4: 'count'})

    dataStructure = {'name': 'Places I\'ve visited', 'children': []}
    palette = sns.color_palette('hls', 10).as_hex()

    for data in df.iterrows():

        current = dataStructure
        depthCursor = current['children']
        for i, item in enumerate(data[1][:-2]):
            idx = None
            j = None
            for j, c in enumerate(depthCursor):
                if item in c.values():
                    idx = j
            if idx == None:
                depthCursor.append({
                    'name': item,
                    'children': [],
                    'hex': random.choice(palette)
                })
                idx = len(depthCursor) - 1

            depthCursor = depthCursor[idx]['children']
            if i == len(data[1]) - 3:
                depthCursor.append({
                    'name': '{}'.format(list(data[1])[-2]),
                    'value': list(data[1])[-1],
                    'hex': random.choice(palette)
                })

            current = depthCursor

    return dataStructure


def get_photo_month_counts(user):
    counts = Photo.objects \
        .filter(owner=user) \
        .exclude(exif_timestamp=None) \
        .annotate(month=TruncMonth('exif_timestamp')) \
        .values('month') \
        .annotate(c=Count('image_hash')) \
        .values('month', 'c')

    all_months = [
        c['month'] for c in counts
        if c['month'].year >= 2000 and c['month'].year <= datetime.now().year
    ]
    
    if len(all_months) > 0:

        first_month = min(all_months)
        last_month = max(all_months)

        month_span = jump_by_month(first_month, last_month)
        counts = sorted(counts, key=lambda k: k['month'])

        res = []
        for count in counts:
            key = '-'.join([str(count['month'].year), str(count['month'].month)])
            count = count['c']
            res.append([key, count])
        res = dict(res)

        out = []
        for month in month_span:
            m = '-'.join([str(month.year), str(month.month)])
            if m in res.keys():
                out.append({'month': m, 'count': res[m]})
            else:
                out.append({'month': m, 'count': 0})

        return out
    else:
        return []


captions_sw = [
    'a', 'of', 'the', 'on', 'in', 'at', 'has', 'holding', 'wearing', 'with',
    'this', 'there', 'man', 'woman', '<unk>', 'along', 'no', 'is', 'big',
    'small', 'large', 'and', 'backtround', 'looking', 'for', 'it', 'area',
    'distance', 'was', 'white', 'black', 'brown', 'blue', 'background',
    'ground', 'lot', 'red', 'wall', 'green', 'two', 'one', 'top', 'bottom',
    'behind', 'front', 'building', 'shirt', 'hair', 'are', 'scene', 'tree',
    'trees', 'sky', 'window', 'windows', 'standing', 'glasses', 'building',
    'buildings'
]
captions_sw = [
    'a', 'of', 'the', 'on', 'in', 'at', 'has', 'with', 'this', 'there',
    'along', 'no', 'is', 'it', 'was', 'are', 'background'
]


def get_searchterms_wordcloud(user):
    photos = Photo.objects.filter(owner=user).prefetch_related('faces__person')
    captions = []
    locations = []
    people = []

    location_entities = []
    for photo in photos:
        faces = photo.faces.all()
        for face in faces:
            people.append(face.person.name)
        if photo.search_captions:
            captions.append(photo.search_captions)
        if photo.search_location:
            locations.append(photo.search_location)
        if photo.geolocation_json and 'features' in photo.geolocation_json.keys(
        ):

            for feature in photo.geolocation_json['features']:
                if not feature['text'].isdigit(
                ) and 'poi' not in feature['place_type']:
                    location_entities.append(feature['text'].replace(
                        '(', '').replace(')', ''))

    caption_tokens = ' '.join(captions).replace(',', ' ').split()
    location_tokens = ' '.join(locations).replace(',', ' ').replace(
        '(', ' ').replace(')', ' ').split()

    caption_tokens = [
        t for t in caption_tokens
        if not t.isdigit() and t.lower() not in captions_sw
    ]
    location_tokens = [t for t in location_tokens if not t.isdigit()]

    caption_token_counts = Counter(caption_tokens)
    location_token_counts = Counter(location_tokens)

    location_token_counts = Counter(location_entities)

    people_counts = Counter(people)

    caption_token_counts = [{
        'label': key,
        'y': np.log(value)
    } for key, value in caption_token_counts.most_common(50)]
    location_token_counts = [{
        'label': key,
        'y': np.log(value)
    } for key, value in location_token_counts.most_common(50)]
    people_counts = [{
        'label': key,
        'y': np.log(value)
    } for key, value in people_counts.most_common(50)]

    out = {
        'captions': caption_token_counts,
        'locations': location_token_counts,
        'people': people_counts
    }
    return out
