---
title: "😃 Face recognition"
excerpt: "How to use the face dashboard"
sidebar_position: 3
---

## Label a face

To label a face, click on the green plus button. A pop-up will show up where you can either search for already existing person or add a new person. We want to add a new person, so input the name of the person you want to add and click on the green plus. Now the face is associated with the person.

## Change the label of a face

To change a face to a new person, click on the green plus button. Search for the person you want it to change to and click on them. Now the face is associated with the new person.

## Train faces

If you click on the blue button in the face dashboard or if you click on the button "Train" in the settings tab, the system will try to cluster unknown faces and will try to either match them to already known faces or create a new unknown person. To see the recommendations go to the inferred tab in the face dashboard. There you can for each face the confidence of the match. If you want to confirm a recommended face, select the face and click on the green plus button to add it to the person.

## Delete faces

Sometimes the face recognition will find a face, that is not actually a face. To remove it select the face and the click on the trashcan symbol. The face is the no longer in the system and the face data is going to be deleted.

## Rescan faces

Some user deleted all the faces with the delete face action. To get the faces again you can rescan the faces. This will take a while, because it will then have to look up all photos again for faces.

## Workflow

After you first scan is finished, go to the face dashboard. Label a couple of faces per person. Then train the faces with the blue button. Check if the inferred faces are accurate and add a couple of the inferred faces to the labels. Train the faces again. You will get the best results if all the persons on the pictures are known and when every label has at least a couple of faces.

## Current limitations

- You can only display up to 50000 faces. After that no more faces will be shown, but they are still in the system
- There is no action yet, to just confirm faces in the inferred tab
