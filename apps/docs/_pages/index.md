---
title: "Documentation"
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
	{% capture category_id %}{{ category | first }}{% endcapture %}
	{% assign category_articles = site.categories[category_id] | reverse %}
	{% if category_articles != null %}
	{% capture category_name %}
	{% for data_category in site.data.categories %}
	{% assign data_category_id = data_category.id | escape %}
	{% if data_category_id == category_id %}
	{{ data_category.name }}
	{% break %}
	{% endif %}
	{% endfor %}
	{% endcapture %}
	<li><a href="/{{ category_id }}">{{ category_name }}</a></li>
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