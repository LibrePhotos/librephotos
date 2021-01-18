---
title: "Libre Docs how to"
excerpt: "How to use Libre Docs."
last_modified_at: 2020-01-17
category: Contribution
sidebar: ""
---

## Welcome!

### The Propose

 This Document repository is a one stop shop for all resources for Libre Photos. From installation including one off cases, to how the code actually works.

So how do we add information to the document repository. It is easy just do a pull request to the [librephotos.docs](https://github.com/LibrePhotos/librephotos.docs "librephotos.docs") repository.

## Categories explained

Categories how we organize the information. Categories have to be declared in two locations. In the file name and in the file itself.  


| Category Name          | Category Number |
| :--------------------- | :-------------- |
| Installation           | 01              |
| Data Collection        | 02              |
| Contribution           | 03              |
| Dev Resources Frontend | 04              |
| Dev Resources Backend  | 05              |
| Dev Resources Nginx    | 06              |
| Dev Resources Redress  | 07              |
| Dev Resources Docker   | 08              |

Lets take a moment and look at each section and how the file name should be set up and the front matter in each file. 

### File Names
File names are very easy to do once you understand how it works. 
The name of the file is can be broken up into 4 sections.
an example valid file name would be 0000-03-01-contrib-docs.md 

#### Section 1
This has to not change and start with 0000

#### Section 2
This is the category number from above should always be two digits. 

#### Section 3
 Article / post number. This sets the order that the articles should appear in starting at 01. 

#### Section 4 
 This one is easy. it is just a short descriptive name. Needs to end in .md.

### Front Matter
At the start of each page there needs to be a little bit of header info so that the documents can be built correctly. 
The minimum that needs to be include is as below. 

```markdown
---
title: "Structure"
excerpt: "How the theme is organized and what all of the files are for."
last_modified_at: 2018-03-20
category: getting-started
---
```

Use a category name from the table above to ensure proper documentation build. 
