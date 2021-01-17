---
title: "LibrePhotos Installation Guide"
excerpt: "How to install Libre Photos"
author_profile: true
---

{% assign posts_size = site.posts | size %}
{% if posts_size > 0 %}

## Table of Contents

<ul>
	{% for category in site.categories %}
	{% capture category_name %}{{ category | first }}{% endcapture %}
	{% assign category_articles = site.categories[category_name] %}
	{% if category_articles != null %}
	<li><a href="/{{ category_name | slugify }}">{{ category_name }}</a></li>
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