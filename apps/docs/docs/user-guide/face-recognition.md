---
title: "😃 Face recognition"
excerpt: "How to use the face dashboard"
sidebar_position: 3
---

## Label a face

To label a face, click on the green plus button. A pop-up will show up where you can either search for an already existing person or add a new person. We want to add a new person, so input the name of the person you want to add and click on the green plus. Now the face is associated with the person.

## Change the label of a face

To change a face to a new person, click on the green plus button. Search for the person you want it to change to and click on them. Now the face is associated with the new person.

## Train faces

If you click on the blue button in the face dashboard or if you click on the button "Train" in the settings tab, the system will try to cluster unknown faces and will try to either match them to already known faces or create a new unknown person. To see the recommendations, go to the inferred tab in the face dashboard. There you can for each face the confidence of the match. If you want to confirm a recommended face, select the face and click on the green plus button to add it to the person.

## Delete faces

Sometimes the face recognition might find a face that is not actually a face. To remove it, select the face and the click on the trashcan symbol. The face is the no longer in the system and the face data is going to be deleted.

## Re-scan faces

Some user deleted all the faces with the delete face action. To get the faces again, you can re-scan the faces. This will take a while, because it will then have to look up all the photos again for faces.

## Workflow

After the first scan finished, go to the face dashboard. Label a couple of faces per person. Then train the faces with the blue button. Check if the inferred faces are accurate and add a couple of the inferred faces to the labels. Train the faces again. You will get the best results if all the persons in the pictures are known and when every label has at least a couple of faces.

## Pipeline

### Face Detection

We have two methods on how to extract faces from images. `hog` is fast even on CPUs and does not take up significant RAM, which `cnn` is accurate, but uses a lot of resources.

### Face Quality

At the moment no matter, which detection methods we use, there will be face detected, which are not actually faces. The user has to manually delete these faces. In the future, we will have a new classifier, which determines if it is a face and how likely it is a face.

### Face Recognition

Creates a 512 dimension embedding for a given face. It makes them comparable with each other. Right now we only have the one method and should be good enough.

### Face Clustering

Clustering solves the issue of a system, which has no labelled persons yet. Users can get clusters they can name instead of going through a lot of faces and naming them. Clustering is stable, which means that you will get the same clusters out, when you put the same data in. If you label more faces, this will have no impact on face clustering at the moment. If you want to change how clustering is done, either change the settings, add images or delete wrong faces.

Steps which could be done to improve clustering are combining very similar faces from e.g. a serial recording or photo shoot, to prevent from too many small images to be clustered.

### Face Cluster Merging

We could train a classifier to merge faces, based on previous merge decisions, which could improve the clusters even more.

### Face Classification

Classification matches unknown faces against already known persons. Unlike clustering (which groups all faces from scratch), classification respects your previous labelling input and only tries to match faces to people you've already identified. This makes it much more accurate for large datasets where most persons are already known. You can filter between cluster and classification results in the face dashboard, and see the label probability for each inferred face. Classification probabilities are saved alongside clustering probabilities, so you can compare both approaches.
