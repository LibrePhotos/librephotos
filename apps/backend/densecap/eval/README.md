
# Dense Captioning mAP evaluation

### Dense Captioning Metric

The code in these files is concerned with computing the Dense Captioning metric. The metric is inspired by the meap Average Precision in object detection literature in that it uses a set of thresholds, for each threshold it computes average precision, and the final number is the mean. In ordinary object detection one would sweep through IoU (Intersection over Union) overlaps at thresholds of `0.3, 0.4, 0.5, 0.6, 0.7` (the latest recommendation is to use all of these thresholds instead of only using `0.5`, as done previously), and consider a candidate detection to be correct if it satisfied the desired overlap. In Dense Captioning we don't only evaluate **localization** but also **captioning**. Therefore, we also compute the [METEOR](http://www.cs.cmu.edu/~alavie/METEOR/README.html) score for every candidate detection and consider a candidate detection correct if it is *both* above a localization threshold **and** a METEOR score threshold. This is then interpreted as both a correctly localized and correctly described prediction.

The METEOR thresholds we use are `0, 0.05, 0.1, 0.15, 0.2, 0.25`, so the total number of pairwise thresholds we have to compute the score over is `5 x 6 = 30` (5 for IoU overlap thresholds 6 for METEOR thresholds). Note that the 0 threshold isn't a mistake or a "catchall" because we want the score to be strictly greater.

### Important functions

The most important entry point to evaluation is inside `eval_utils.lua`, and it's the `DenseCaptioningEvaluator` class. You'll notice that it has an `addResult()` function, and most of the heavy lifting of the evaluation is in the `evaluate()` function.

One important and perhaps non-trivial point to mention is that we use `merge_boxes()` to merge ground truth boxes in the VG data that heavily overlap (`>=0.7` IoU) into a single ground truth box with multiple reference captions.


### Java, Python, Lua

Unfortunately the METEOR code is in Java and it's not easy to communicate with this process directly from Lua. Therefore, we adapted the Python wrapper written by Xinlei Chen from the MSCOCO challenge that communicates with the Java process using `subprocess`, and the Lua code communicates with this Python script (`meteor_bridge.py`) through `json` files. As a result, this ends up being unfortunately quite hairy at the moment.

### Requirements

- Java. METEOR requires Java installed. On Ubuntu you can do `sudo apt-get install default-jre`. You can do `java -version` to confirm that you have it installed.
- You'll need to download the METEOR binary `meteor-1.5.jar` and place it in `eval` folder and also `paraphrase-en.gz` and place it it in `eval/data` folder. You can do this automatically by running the script `scripts/setup_eval.sh` from the project's root directory.

