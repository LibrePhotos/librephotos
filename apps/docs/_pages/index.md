---
title: "LibrePhotos Documentation"
excerpt: "A self-hosted Google Photos clone, with a slight focus on cool graphs."
sidebar: ""
author_profile: true
permalink: /
---

## Table of Contents

{% assign first_post = true %}
{% assign latest_date = first_post.last_modified_at | date: "%s" %}

<ul>
	{% for category in site.categories %}
	{% capture category_name %}{{ category | first }}{% endcapture %}
	{% assign category_articles = site.categories[category_name] %}
	<li><a href="/{{ category_name | slugify }}">{{ category_name }}</a></li>
	{% if category_articles != null %}
	<ul>
	{% for article in category_articles %}
	{% assign article_last_modified_at = article.last_modified_at | date: "%s" %}
	{% if first_post == true %}
	{% assign latest_date = article.last_modified_at | date: "%s" %}
	{% assign first_post = false %}
	{% elsif article_last_modified_at > latest_date %}
	{% assign latest_date = article_last_modified_at %}
	{% endif %}
	<li><a href="{{ article.url | relative_url }}">{{ article.title }}</a></li>
	{% endfor %}
	</ul>
	{% endif %}
	{% endfor %}
</ul>