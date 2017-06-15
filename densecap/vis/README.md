
### Visualization interface

When you run `run_model.lua` with `-output_vis 1` (default) it will write the images and a json struct to this folder's `data/` directory. These can then be viewed with this nice html interface.

For example, to evaluate a checkpoint on some VG test data:

```
th run_model.lua -checkpoint data/checkpoint.t7 -input_split test -vg_img_root_dir  /path/to/visual-genome/images -max_images 10
```

and then start a webbrowser, e.g. `python -m SimpleHTTPServer` and open the `view_results.html` file!
