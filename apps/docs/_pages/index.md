---
title: "LibrePhotos Documentation"
excerpt: "A self-hosted Google Photos clone, with a slight focus on cool graphs."
sidebar: ""
author_profile: true
permalink: /
---

{% assign posts_size = site.posts | size %}
{% if posts_size > 0 %}

## Table of Contents

<ul>
	{% for category in site.categories %}
	{% capture category_name %}{{ category | first }}{% endcapture %}
	{% assign category_articles = site.categories[category_name] %}
	{% if category_articles != null %}
	{% assign category_name_split = category_name | replace: "-", " " | replace: "_", "-" | split: " " %}
	{% capture category_name_capitalised %}{% for word in category_name_split %}{{ word | capitalize }} {% endfor %}{% endcapture %}
	<li><a href="/{{ category_name | slugify }}">{{ category_name_capitalised }}</a></li>
	<ul>
	{% for article in category_articles %}
	<li><a href="{{ article.url | relative_url }}">{{ article.title }}</a></li>
	{% endfor %}
	</ul>
	{% endif %}
	{% endfor %}
</ul>

{% else %}

## Under Construction

Our documentation is currently being written - check back soon!

{% endif %}