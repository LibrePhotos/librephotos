# Commercial services: condensed findings (helper agents, primary vendor pages, fetched 2026-10-16)

Condensed from three helper reports (Google+Amazon, Apple+Microsoft, Adobe+Synology). Vendor statements are vendor claims. UNVERIFIED items are left out here.

## Metadata stays in the service

| Service | Finding | Source |
| --- | --- | --- |
| Google Photos | Takeout writes service metadata to a JSON sidecar, not into the file | https://support.google.com/photos/answer/3024190 |
| Google Photos | Date edits are not in downloaded files | https://support.google.com/photos/answer/6128850 |
| Google Photos | Location edits are not in downloaded files | https://support.google.com/photos/answer/6153599 |
| Amazon Photos | No bulk export with metadata; whole albums can't be downloaded on web | https://www.amazon.com/gp/help/customer/display.html?nodeId=GVCELKY5JW77VE7W |
| Apple | Export Unmodified Original + optional "Export IPTC as XMP" (keywords/IPTC only); faces, ratings and edited date/location in export undocumented | https://support.apple.com/guide/photos/export-photos-videos-slideshows-and-memories-pht6e157c5f/mac |
| Apple | Transfer to Google sends the most recent edit only and drops shared albums, smart albums, Live Photos and "some metadata" | https://support.apple.com/en-us/118257 |
| Microsoft OneDrive | No documented write-back of tags, people or favourites into files | — |
| Synology Photos | Writes tags, description, rating, rotation and date only into jpg/png/cr2 (embedded, no sidecars). HEIC, CR3 and video edits stay in the package. Faces and location are not written | https://kb.synology.com/en-global/DSM/tutorial/What_metadata_standards_does_Synology_Photos_support |
| Lightroom Classic | Writes XMP only when "Automatically write changes into XMP" is on (catalog by default); .acr sidecar since 15.0 | https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/create-xmp-acr-files.html |

## Deletion and inactivity

- **Google:** content may be deleted after 2 years inactive or 2 years over quota. https://support.google.com/photos/answer/10100180
- **Amazon:** files deleted newest-first after 180 days over quota; everything deleted after 2 years inactive. https://www.amazon.com/gp/help/customer/display.html?nodeId=G202146630
- **Amazon:** may scan photos for shopping recommendations. https://www.amazon.com/gp/help/customer/display.html?nodeId=G3BC9SVPPEVSB9T8

## AI is going cloud, paid and region-gated

- **Google:** all Gemini features in Photos are 18+, mostly US-only and increasingly AI Plus/Pro/Ultra. https://support.google.com/photos/answer/15344015
- **Google:** connecting Photos to Gemini isn't available in any EU country, the UK, Switzerland, Norway, Canada or Korea. https://support.google.com/gemini/answer/15734842
- **Apple:** Clean Up, Extend and Spatial Reframing run on server models, partly on Google Cloud; "expanded access … for a fee in the future". https://support.apple.com/en-us/127901 and https://security.apple.com/blog/expanding-pcc/
- **Apple:** face and scene analysis is still on-device. https://www.apple.com/legal/privacy/data/en/photos/
- **Microsoft:** OneDrive face grouping runs in the cloud; Restyle is Premium-only ($19.99/mo). https://support.microsoft.com/en-us/onedrive/windows/browse-your-photos-on-windows
- **Microsoft:** Family storage is cut from up to 6 × 1 TB to a shared 2 TB pool (new subscriptions from 2026-10-08). https://support.microsoft.com/en-us/onedrive/changes-to-microsoft-365-storage
- **Adobe:** People View runs on Adobe's servers and isn't available for uploads from Illinois/Texas; partner-model features (Topaz, Veo, Nano Banana) cost credits. https://helpx.adobe.com/lightroom/desktop/organize-photos/people-view.html and https://helpx.adobe.com/creative-cloud/apps/generative-ai/generative-credits-faq.html
- **Synology:** recognition is on-box but limited by NAS model and RAM; new on-device embedding/OCR/captioning is GPU-only beta and not in Photos. https://kb.synology.com/en-global/DSM/tutorial/Which_Synology_NAS_models_support_the_facial_recognition_feature_on_Synology_Photos

## Converging features to watch

- **Apple:** star ratings (iOS 27); shared albums people can join on the web without an Apple account. https://support.apple.com/en-us/108916
- **Microsoft:** the new Windows Photos app shows one gallery across PC, OneDrive and iCloud, with natural-language search and Moments (Insiders 2026-10-15). https://blogs.windows.com/windowsexperience/2026/10/15/meet-the-new-photos-app-on-windows-11/ Its OneDrive + Copilot event is on 2026-10-20.
- **Adobe:** natural-language search in cloud Lightroom, indexed server-side; no AI captions. https://helpx.adobe.com/lightroom/desktop/organize-photos/organize-photos.html
