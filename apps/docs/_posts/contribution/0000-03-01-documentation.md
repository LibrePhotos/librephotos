---
title: "Documentation"
excerpt: "How to contribute to the LibrePhotos documentation."
last_modified_at: 2021-03-07
category: 3

gallery:
  - url: /assets/images/logo-round.png
    image_path: /assets/images/logo-round.png
    alt: "Round LibrePhotos logo"
    title: "Round LibrePhotos logo"
  - url: /assets/images/logo-square.png
    image_path: /assets/images/logo-square.png
    alt: "Square LibrePhotos logo"
    title: "Square LibrePhotos logo"

feature_row:
  - image_path: /assets/images/logo-square.png
    alt: "Square LibrePhotos logo"
    title: "Square LibrePhotos logo"
    excerpt: "Excerpt 1."
  - image_path: /assets/images/logo-round.png
    alt: "Round LibrePhotos logo"
    title: "Round LibrePhotos logo"
    excerpt: "Excerpt 2."
    url: "/"
    btn_label: "Button"
    btn_class: "btn--inverse"
  - image_path: /assets/images/logo-square.png
    alt: "Square LibrePhotos logo"
    title: "Square LibrePhotos logo"
    excerpt: "Excerpt 3."
---

## Overview

Contributing to our documentation is as simple as submitting a pull request to the [librephotos.docs repository](https://github.com/LibrePhotos/librephotos.docs/wiki "librephotos.docs"). Below is an explanation of all the templated elements available and the naming conventions used, along with details of how to preview this site locally.

## Previewing Locally

### Manually

To compile the site and view it locally before submitting your pull request, first install the required packages for your OS:

* [Ubuntu](https://jekyllrb.com/docs/installation/ubuntu/)
* [Windows](https://jekyllrb.com/docs/installation/windows/) (make sure you install Ruby `2.x`, not `3.x`)
* [macOS](https://jekyllrb.com/docs/installation/macos/)
* [Other Linux](https://jekyllrb.com/docs/installation/other-linux/)

Then open the terminal (Command Prompt on Windows) and navigate to the repository:

```sh
cd /path/to/folder
```

Install `jekyll` and `bundler`:

```sh
gem install jekyll bundler
```

Finally, to preview the site:

```sh
bundle exec jekyll serve
```

Some information will then be displayed - e.g.:

```
Configuration file: ~/librephotos-docs/_config.yml
            Source: ~/librephotos-docs
       Destination: ~/librephotos-docs/_site
 Incremental build: disabled. Enable with --incremental
      Generating...
                    done in 10.451 seconds.
 Auto-regeneration: enabled for '~/librephotos-docs'
    Server address: http://127.0.0.1:4000
  Server running... press ctrl-c to stop.
```

Visit the URL next to `Server address:`.

### Using Dev Container

To make the process more consistant you can use the dev container in Visual Studio Code. To do this open the folder you cloned the `librephotos.docs` repository to and run `code .`. Visual Studio Code will then prompt you to run in a container. This will take a while the firect time as the container is being built.

When in the container you can use the Tasks to run the site locally and test using [http://localhost:4000/](http://localhost:4000/).

## Naming

### Categories

Articles are organised by category; each article's category has to be declared in both the file name and the file content. This will be explained below. The available categories are:

| {% assign categories_table = " | Category Name | Category Number |
| ------------------------------ | :-----------: |" %}
{% for category in site.data.categories %}
{% assign categories_table = categories_table | append: "
| " | append: category.name | append: " | " | append: category.id | append: " |" %}
{% endfor %}

{{ categories_table }}

### File Names

File names contain four parts; and an example valid file name would be `0000-03-01-documentation.md`.

* First group of numbers: always `0000`.
* Second group of numbers: the category number (from above). It should always be two digits.
  * The example above has `03`, which means the article is in the `Contribution` category.
* Third group of numbers: the article number. Starting at `01`, this sets the order in which the articles appear. It should always be two digits.
  * The example above has `01`, meaning it is the first article in the category
* Fourth section (text): a short name for the article. This must end in `.md`.

### Front Matter

The start of each page includes header info (called *front matter*), which ensures that articles are built correctly. Extra options are required if using [galleries](#gallery) or [feature rows](#feature-row), but the minimum requirement is:

```markdown
---
title: "Article Title"
excerpt: "A short description of what the article is about."
last_modified_at: 2020-01-18
category: 1
---
```

Ensure you use a category ID from the table above and update the `last_modified_at` date.

## Templated Elements

### Text Formatting

#### Bold

```markdown
**text**
```

Produces: **text**

#### Italics

```markdown
*text*
```

Produces: *text*

#### Underline

```markdown
__text__
```

Produces: __text__

#### Strikethrough

```markdown
~~text~~
```

Produces: ~~text~~

#### Monospace

```html
<kbd>text</kbd>
```

Produces: <kbd>text</kbd>

#### Superscript

```html
<sup>text</sup>
```

Produces: <sup>text</sup>

#### Subscript

```html
<sub>text</sub>
```

Produces: <sub>text</sub>

#### Links

```markdown
[DuckDuckGo](https://duckduckgo.com)
```

Produces: [DuckDuckGo](https://duckduckgo.com)

#### Inline code block

```markdown
`<div></div>`
```

Produces: `<div></div>`

#### Formatted code block

````markdown
```html
<div></div>
```
````

Produces:

```html
<div></div>
```

#### Abbreviation

```markdown
CSS stands for "Cascading Style Sheets".

*[CSS]: Cascading Style Sheets
```

Produces: CSS stands for "Cascading Style Sheets".

*[CSS]: Cascading Style Sheets

### Lists

#### Unordered list

```markdown
* Item 1
    * Item 2
* Item 3
```

* Item 1
  * Item 2
* Item 3

#### Ordered list

```markdown
1. Item 1
    1. Item 2
2. Item 3
    * Item 4
```

1. Item 1
    1. Item 2
2. Item 3
    * Item 4

### Notices

| Notice Type | Class            |
| ----------- | ---------------- |
| Default     | .notice          |
| Primary     | .notice--primary |
| Info        | .notice--info    |
| Warning     | .notice--warning |
| Success     | .notice--success |
| Danger      | .notice--danger  |

```markdown
**Watch out!** A notice...
{: .notice}
```

**Watch out!** A notice...
{: .notice}

```markdown
**Watch out!** A notice...
{: .notice--primary}
```

**Watch out!** A notice...
{: .notice--primary}

```markdown
**Watch out!** A notice...
{: .notice--info}
```

**Watch out!** A notice...
{: .notice--info}

```markdown
**Watch out!** A notice...
{: .notice--warning}
```

**Watch out!** A notice...
{: .notice--warning}

```markdown
**Watch out!** A notice...
{: .notice--success}
```

**Watch out!** A notice...
{: .notice--success}

```markdown
**Watch out!** A notice...
{: .notice--danger}
```

**Watch out!** A notice...
{: .notice--danger}

### Buttons

Links can be made into buttons by applying the `btn` class:

```markdown
[Link](#){: .btn}
```

Other classes can be added to change the button's appearance, as seen below. Size and type classes can be combined (e.g. `[Text](#){: .btn .btn--primary .btn--large}`) or used on their own (e.g. `[Text](#){: .btn .btn--large}`).

| Button Type   | Example                               | Class                    | Syntax                                  |
| ------------- | ------------------------------------- | ------------------------ | --------------------------------------- |
| Default       | [Text](#){: .btn}                     | .btn                     | `[Text](#){: .btn}`                     |
| Primary       | [Text](#){: .btn .btn--primary}       | .btn .btn--primary       | `[Text](#){: .btn .btn--primary}`       |
| Info          | [Text](#){: .btn .btn--info}          | .btn .btn--info          | `[Text](#){: .btn .btn--info}`          |
| Success       | [Text](#){: .btn .btn--success}       | .btn .btn--success       | `[Text](#){: .btn .btn--success}`       |
| Warning       | [Text](#){: .btn .btn--warning}       | .btn .btn--warning       | `[Text](#){: .btn .btn--warning}`       |
| Danger        | [Text](#){: .btn .btn--danger}        | .btn .btn--danger        | `[Text](#){: .btn .btn--danger}`        |
| Inverse       | [Text](#){: .btn .btn--inverse}       | .btn .btn--inverse       | `[Text](#){: .btn .btn--inverse}`       |
| Light Outline | [Text](#){: .btn .btn--light-outline} | .btn .btn--light-outline | `[Text](#){: .btn .btn--light-outline}` |

| Button Size | Example                                       | Class              | Syntax                                          |
| ----------- | --------------------------------------------- | ------------------ | ----------------------------------------------- |
| Extra Large | [Text](#){: .btn .btn--primary .btn--x-large} | .btn               | `[Text](#){: .btn .btn--primary .btn--x-large}` |
| Large       | [Text](#){: .btn .btn--primary .btn--large}   | .btn .btn--primary | `[Text](#){: .btn .btn--primary .btn--large}`   |
| Default     | [Text](#){: .btn .btn--primary}               | .btn .btn--info    | `[Text](#){: .btn .btn--primary}`               |
| Small       | [Text](#){: .btn .btn--primary .btn--small}   | .btn .btn--success | `[Text](#){: .btn .btn--primary .btn--small}`   |

### Blockquotes

#### Single line blockquote

```markdown
> Stay hungry. Stay foolish.
```

> Stay hungry. Stay foolish.

#### Multi line blockquote with cite reference

```markdown
> People think focus means saying yes to the thing you've got to focus on. But that's not what it means at all. It means saying no to the hundred other good ideas that there are. You have to pick carefully.
>
> I'm actually as proud of the things we haven't done as the things I have done. Innovation is saying no to 1,000 things.

<cite>Steve Jobs</cite> --- Apple Worldwide Developers' Conference, 1997
{: .small}
```

> People think focus means saying yes to the thing you've got to focus on. But that's not what it means at all. It means saying no to the hundred other good ideas that there are. You have to pick carefully.
>
> I'm actually as proud of the things we haven't done as the things I have done. Innovation is saying no to 1,000 things.

<cite>Steve Jobs</cite> --- Apple Worldwide Developers' Conference, 1997
{: .small}

### Tables

```markdown
| Employee                           | Salary |            |
| ---------------------------------- | ------ | ---------- |
| John Doe                           | $15K   | Some text. |
| [Jane Doe](https://duckduckgo.com) | $100K  | More text. |
```

| Employee                           | Salary |            |
| ---------------------------------- | ------ | ---------- |
| John Doe                           | $15K   | Some text. |
| [Jane Doe](https://duckduckgo.com) | $100K  | More text. |

Colons can be added to the column separators to define alignment:

```markdown
| Left Align                                | Center Align | Right Align |
| :---------------------------------------- | :----------: | ----------: |
| cell1                                     |    cell2     |       cell3 |
| cell4                                     |    cell5     |       cell6 |
| ----------------------------------------- |
| cell1                                     |    cell2     |       cell3 |
| cell4                                     |    cell5     |       cell6 |
| ========================================= |
| Footer 1                                  |   Footer 2   |    Footer 3 |
```

| Left Align                                | Center Align | Right Align |
| :---------------------------------------- | :----------: | ----------: |
| cell1                                     |    cell2     |       cell3 |
| cell4                                     |    cell5     |       cell6 |
| ----------------------------------------- |
| cell1                                     |    cell2     |       cell3 |
| cell4                                     |    cell5     |       cell6 |
| ========================================= |
| Footer 1                                  |   Footer 2   |    Footer 3 |

### Term/Definition Lists

```markdown
Term 1
:   Definition 1.

Term 1
:   Definition 2.
```

Term 1
:   Definition 1.

Term 1
:   Definition 2.

## Images & Videos

### Figures (Images)

| Parameter      | Required     | Description                                                                                                                                   |
| -------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **image_path** | **Required** | Full path to image - e.g. `/assets/images/filename.jpg`. Use absolute URLs (including `https://` and the domain) for those hosted externally. |
| **alt**        | Optional     | Alternate text for image (displays if image fails to load).                                                                                   |
| **caption**    | Optional     | Figure caption text. Markdown is allowed (e.g. bold, italics, links).                                                                         |

Images stored in this repository should be in the `/assets/images/` folder.

Usage:

{% raw %}

```liquid
{% include figure image_path="/assets/images/logo-round.png" alt="LibrePhotos logo" caption="Image caption." %}
```

{% endraw %}

{% include figure image_path="/assets/images/logo-round.png" alt="LibrePhotos logo" caption="Image caption." %}

### Videos

Videos can be embedded if they are stored on YouTube, Vimeo, Google Drive, or this repository.

{% raw %}

```liquid
{% include video id="id" provider="provider" %}
```

{% endraw %}

| Parameter  | Required     | Description                                                                   |
| ---------- | ------------ | ----------------------------------------------------------------------------- |
| `id`       | **Required** | ID of the video                                                               |
| `provider` | **Required** | Hosting provider of the video: `youtube`, `vimeo`, `google-drive`, or `local` |

#### YouTube

To embed `https://www.youtube.com/watch?v=XsxDH4HcOWA` (or `https://youtu.be/XsxDH4HcOWA`):

{% raw %}

```liquid
{% include video id="XsxDH4HcOWA" provider="youtube" %}
```

{% endraw %}

#### Vimeo

To embed `https://vimeo.com/212731897`:

{% raw %}

```liquid
{% include video id="212731897" provider="vimeo" %}
```

{% endraw %}

#### Google Drive

To embed `https://drive.google.com/file/d/1u41lIbMLbV53PvMbyYc9HzvBug5lNWaO/preview`:

{% raw %}

```liquid
{% include video id="1u41lIbMLbV53PvMbyYc9HzvBug5lNWaO" provider="google-drive" %}
```

{% endraw %}

#### Stored in this Repository

Videos stored in this repository must be stored in the `/assets/videos/` directory. To embed a video at `/assets/videos/video.mp4`:

{% raw %}

```liquid
{% include video id="video.mp4" provider="local" %}
```

{% endraw %}

### Gallery

Galleries are groups of images.

{% include gallery caption="Sample **gallery**." %}

They use some additional front matter:

```yaml
gallery:
  - url: /assets/images/logo-round.png
    image_path: /assets/images/logo-round.png
    alt: "Round LibrePhotos logo"
    title: "Round LibrePhotos logo"
  - url: /assets/images/logo-square.png
    image_path: /assets/images/logo-square.png
    alt: "Square LibrePhotos logo"
    title: "Square LibrePhotos logo"
```

| Name           | Required     | Description                                                                                                                             |
| -------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **url**        | Optional     | URL of image to link to, which is opened when the gallery image is clicked.                                                             |
| **image_path** | **Required** | Full path to image eg: `/assets/images/image.jpg`. Use absolute URLs (including `https://` and the domain) for those hosted externally. |
| **alt**        | Optional     | Alternate text for image (displays if image fails to load).                                                                             |
| **title**      | Optional     | Title text for image. Will display as a caption when gallery image is clicked, if `url` option has been specified.                      |

Include the gallery with:
{% raw %}

```liquid
{% include gallery caption="Sample **gallery**." %}
```

{% endraw %}

This also has some parameters:

| Parameter   | Required | Description                                                                                                                                                                                                       | Default                                                                      |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **id**      | Optional | To add multiple galleries to a document, uniquely name them in the front matter (by replacing `gallery:` in the example above) and reference them in `{% raw %}{% include gallery id="gallery_id" %}{% endraw %}` | `gallery`                                                                    |
| **layout**  | Optional | Layout type. 2 column: `half`, 3 column: `third`, single column: `''` (blank)                                                                                                                                     | Determined by gallery size. Two items: `half`, three or more items: `third`. |
| **class**   | Optional | Use to add a `class` attribute to the surrounding `<figure>` element for additional styling needs.                                                                                                                |                                                                              |
| **caption** | Optional | Gallery caption description. Markdown is allowed.                                                                                                                                                                 |                                                                              |

### Feature Row

Feature rows contain three content blocks with text and an image.

{% include feature_row %}

They use some additional front matter:

```yaml
feature_row:
  - image_path: /assets/images/logo-grey.png
    alt: "Grey LibrePhotos logo"
    title: "Grey LibrePhotos logo"
    excerpt: "Excerpt 1."
  - image_path: /assets/images/logo-round.png
    alt: "Round LibrePhotos logo"
    title: "Round LibrePhotos logo"
    excerpt: "Excerpt 2."
    url: "/"
    btn_label: "Button"
    btn_class: "btn--inverse"
  - image_path: /assets/images/logo-square.png
    alt: "Square LibrePhotos logo"
    title: "Square LibrePhotos logo"
    excerpt: "Excerpt 3."
```

| Name              | Required     | Description                                                                                                                                | Default                            |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| **image_path**    | **Required** | Full path to image - e.g. `/assets/images/image.jpg`. Use absolute URLs (including `https://` and the domain) for those hosted externally. |                                    |
| **image_caption** | Optional     | Caption for image. Markdown is allowed                                                                                                     |                                    |
| **alt**           | Optional     | Alternate text for image(displays if image fails to load).                                                                                 |                                    |
| **title**         | Optional     | Content block title.                                                                                                                       |                                    |
| **excerpt**       | Optional     | Content block excerpt text. Markdown is allowed.                                                                                           |                                    |
| **url**           | Optional     | URL that the button should link to.                                                                                                        |                                    |
| **btn_label**     | Optional     | Button text label.                                                                                                                         | `more_label` in UI Text data file. |
| **btn_class**     | Optional     | Button style.                                                                                                                              | `btn`                              |

Include the feature row with:
{% raw %}

```liquid
{% include feature_row %}
```

{% endraw %}

This also has some parameters:

| Include Parameter | Required | Description                                                                                                                                                                                               | Default       |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| **id**            | Optional | To add multiple rows to a document, uniquely name them in the front matter (by replacing `feature_row:` in the example above) and reference in `{% raw %}{% include feature_row id="row2" %}{% endraw %}` | `feature_row` |
| **type**          | Optional | Alignment of the featured blocks in the row. Options include: `left`, `center`, or `right` aligned.                                                                                                       |               |
