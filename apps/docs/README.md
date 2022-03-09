# [LibrePhotos Docs](https://docs.librephotos.com)

Documentation site for [LibrePhotos](https://github.com/LibrePhotos/librephotos)

## Getting started

### Manually

To compile the site and view it locally before submitting your pull request, first install the required packages for
your OS:

- [Ubuntu](https://jekyllrb.com/docs/installation/ubuntu/)
- [Windows](https://jekyllrb.com/docs/installation/windows/) (make sure you install Ruby `2.x`, not `3.x`)
- [macOS](https://jekyllrb.com/docs/installation/macos/)
- [Other Linux](https://jekyllrb.com/docs/installation/other-linux/)

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

For a simpler setup procedure, you can run the dev container in Visual Studio Code. To do this, open the folder you
cloned the `librephotos.docs` repository to and run `code .`. Visual Studio Code will then prompt you to run in a
container. The container will take a while to build.

When in the container, you can use Visual Studio Code's [Tasks function](https://code.visualstudio.com/Docs/editor/tasks)
to build and host the site locally, at [http://localhost:4000/](http://localhost:4000/).
