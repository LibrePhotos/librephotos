"""Every API URL is anchored, slash-tolerant and named by one rule.

``librephotos/urls.py`` has two kinds of hand-written route. A legacy
``re_path()`` keeps a public URL: it starts with ``^``, ends with ``/?$`` (either
slash form and nothing after) and is one of the regexes frozen in
``LEGACY_RE_ROUTES``, so a new one cannot slip in. A new route is a ``path()``
whose literal segments are lowercase kebab case and whose path ends with a
slash. The DRF router's own routes are skipped: DRF anchors them.

``CLIENT_PATHS`` holds every path the web app, the api-client package and the
mobile app send, as each one writes it, with the view it resolves to. The table
was taken before the anchoring change, and the test holds the URLconf to it.
Change an entry only when a client path changes on purpose.
"""

import re
from collections.abc import Iterable

from django.http import HttpRequest, HttpResponse
from django.test import SimpleTestCase
from django.urls import Resolver404, ResolverMatch, URLPattern, path, re_path, resolve
from django.urls.converters import get_converters
from django.urls.resolvers import RegexPattern, RoutePattern

from api.tests.infra.routes import api_routes, function_routes
from librephotos.urls import router

OUR_PACKAGES = frozenset({"api", "nextcloud", "librephotos"})
KEBAB_SEGMENT = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")

# The hand-written legacy routes, by regex. Each one keeps both slash forms
# through /?$. Adding a route means a path() instead; changing one means
# changing its entry here on purpose. The media route (^media/) is not under
# api/, so the walker never holds it to these rules.
LEGACY_RE_ROUTES = frozenset(
    {
        "^api/accounts/oidc/(?P<provider_id>[^/]+)/login/?$",
        "^api/accounts/oidc/(?P<provider_id>[^/]+)/login/callback/?$",
        "^api/addface/?$",
        "^api/auth/password/reset/?$",
        "^api/auth/password/reset/confirm/?$",
        "^api/auth/sso/config/?$",
        "^api/auth/sso/finish/?$",
        "^api/auth/token/blacklist/?$",
        "^api/auth/token/obtain/?$",
        "^api/auth/token/refresh/?$",
        "^api/autoalbumgen/?$",
        "^api/autoalbumtitlegen/?$",
        "^api/classifymedia/?$",
        "^api/clusterfaces/?$",
        "^api/defaultburstrules/?$",
        "^api/defaultrules/?$",
        "^api/delete/zip/(?P<fname>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/?$",
        "^api/deletefaces/?$",
        "^api/deletemissingphotos/?$",
        "^api/dirtree/?$",
        "^api/duplicates/(?P<duplicate_id>[0-9a-f-]+)/?$",
        "^api/duplicates/(?P<duplicate_id>[0-9a-f-]+)/delete/?$",
        "^api/duplicates/(?P<duplicate_id>[0-9a-f-]+)/dismiss/?$",
        "^api/duplicates/(?P<duplicate_id>[0-9a-f-]+)/resolve/?$",
        "^api/duplicates/(?P<duplicate_id>[0-9a-f-]+)/revert/?$",
        "^api/duplicates/?$",
        "^api/duplicates/detect/?$",
        "^api/duplicates/stats/?$",
        "^api/email-config/?$",
        "^api/email-config/test/?$",
        "^api/firsttimesetup/?$",
        "^api/fullscanphotos/?$",
        "^api/generateocr/?$",
        "^api/geocode/search/?$",
        "^api/healthz/?$",
        "^api/healthz/postgresql/?$",
        "^api/healthz/queue/?$",
        "^api/healthz/ready/?$",
        "^api/imagetag/?$",
        "^api/labelfaces/?$",
        "^api/locationsunburst/?$",
        "^api/locationtimeline/?$",
        "^api/locclust/?$",
        "^api/media/diagnostics/(?P<fname>[^/]+)/?$",
        "^api/memories/?$",
        "^api/nextcloud/listdir/?$",
        "^api/nextcloud/scanphotos/?$",
        "^api/photo/share/?$",
        "^api/photo/share/list/?$",
        "^api/photomonthcounts/?$",
        "^api/photos/(?P<image_hash>[a-f0-9]+)/file/(?P<file_hash>[a-f0-9]+)/?$",
        "^api/photos/(?P<image_hash>[a-f0-9]+)/main-file/?$",
        "^api/photos/(?P<photo_id>[0-9a-f-]+)/metadata/?$",
        "^api/photos/(?P<photo_id>[0-9a-f-]+)/metadata/history/?$",
        "^api/photos/(?P<photo_id>[0-9a-f-]+)/metadata/revert-all/?$",
        "^api/photos/(?P<photo_id>[0-9a-f-]+)/metadata/revert/(?P<edit_id>[0-9a-f-]+)/?$",
        "^api/photos/download/?$",
        "^api/photos/metadata/bulk/?$",
        "^api/photosedit/category/?$",
        "^api/photosedit/delete/?$",
        "^api/photosedit/favorite/?$",
        "^api/photosedit/generateim2txt/?$",
        "^api/photosedit/hide/?$",
        "^api/photosedit/makepublic/?$",
        "^api/photosedit/rating/?$",
        "^api/photosedit/rotate/?$",
        "^api/photosedit/savecaption/?$",
        "^api/photosedit/setdeleted/?$",
        "^api/photosedit/share/?$",
        "^api/predefinedburstrules/?$",
        "^api/predefinedrules/?$",
        "^api/public/albums/s/(?P<slug>[^/]+)/?$",
        "^api/public/albums/s/(?P<slug>[^/]+)/photos/(?P<photo_id>[^/]+)/?$",
        "^api/public/photo/(?P<slug>[^/]+)/?$",
        "^api/public/photo/(?P<slug>[^/]+)/media/(?P<kind>[^/]+)/?$",
        "^api/rqavailable/?$",
        "^api/savemetadata/?$",
        "^api/scanfaces/?$",
        "^api/scanphotos/?$",
        "^api/scanuploadedphotos/?$",
        "^api/searchtermexamples/?$",
        "^api/serverlogs/?$",
        "^api/serverlogs/view/?$",
        "^api/serverstats/?$",
        "^api/sitesettings/?$",
        "^api/socialgraph/?$",
        "^api/stacks/(?P<stack_id>[0-9a-f-]+)/?$",
        "^api/stacks/(?P<stack_id>[0-9a-f-]+)/add/?$",
        "^api/stacks/(?P<stack_id>[0-9a-f-]+)/delete/?$",
        "^api/stacks/(?P<stack_id>[0-9a-f-]+)/primary/?$",
        "^api/stacks/(?P<stack_id>[0-9a-f-]+)/remove/?$",
        "^api/stacks/?$",
        "^api/stacks/detect/?$",
        "^api/stacks/manual/?$",
        "^api/stacks/merge/?$",
        "^api/stacks/stats/?$",
        "^api/stats/?$",
        "^api/storagestats/?$",
        "^api/sync/albums/auto/?$",
        "^api/sync/albums/place/?$",
        "^api/sync/albums/tag/?$",
        "^api/sync/albums/thing/?$",
        "^api/sync/albums/user/?$",
        "^api/sync/counts/?$",
        "^api/sync/persons/?$",
        "^api/sync/photos/?$",
        "^api/sync/sharing/?$",
        "^api/timezones/?$",
        "^api/trainfaces/?$",
        "^api/upload/?$",
        "^api/upload/complete/?$",
        "^api/useralbum/makepublic/?$",
        "^api/useralbum/share/?$",
        "^api/wordcloud/?$",
    }
)

CLIENT_PATHS = {
    "/api/addface": "api.views.faces.AddFaceView",
    "/api/albums/auto/1/": "api.views.album_auto.AlbumAutoViewSet delete=destroy,get=retrieve,patch=partial_update",
    "/api/albums/auto/delete_all/": "api.views.album_auto.AlbumAutoViewSet post=delete_all",
    "/api/albums/auto/list/": "api.views.album_auto.AlbumAutoListViewSet get=list",
    "/api/albums/date/1/": "api.views.albums.AlbumDateViewSet get=retrieve",
    "/api/albums/date/list/": "api.views.albums.AlbumDateListViewSet get=list",
    "/api/albums/place/list/": "api.views.albums.AlbumPlaceListViewSet get=list",
    "/api/albums/thing/list/": "api.views.albums.AlbumThingListViewSet get=list",
    "/api/albums/user/1/": "api.views.albums.AlbumUserViewSet delete=destroy,get=retrieve,patch=partial_update",
    "/api/albums/user/edit/": "api.views.albums.AlbumUserEditViewSet post=create",
    "/api/albums/user/edit/1/": "api.views.albums.AlbumUserEditViewSet patch=partial_update",
    "/api/albums/user/list/": "api.views.albums.AlbumUserListViewSet get=list",
    "/api/albums/user/shared/fromme/": "api.views.sharing.SharedFromMeAlbumUserListViewSet get=list",
    "/api/albums/user/shared/tome/": "api.views.sharing.SharedToMeAlbumUserListViewSet get=list",
    "/api/auth/password/reset/": "api.views.password_reset.PasswordResetView",
    "/api/auth/password/reset/confirm/": "api.views.password_reset.PasswordResetConfirmView",
    "/api/auth/sso/config/": "api.views.sso.SSOConfigView",
    "/api/auth/token/blacklist/": "librephotos.urls.LogoutView",
    "/api/auth/token/obtain/": "librephotos.urls.CustomTokenObtainPairView",
    "/api/auth/token/refresh/": "librephotos.urls.CustomTokenRefreshView",
    "/api/autoalbumgen/": "api.views.album_auto.AutoAlbumGenerateView",
    "/api/clusterfaces": "api.views.dataviz.ClusterFaceView",
    "/api/delete/user/1/": "api.views.user.DeleteUserViewSet delete=destroy",
    "/api/deletefaces": "api.views.faces.DeleteFaces",
    "/api/deletemissingphotos": "api.views.scan_triggers.DeleteMissingPhotosView",
    "/api/dirtree/": "api.views.user.RootPathTreeView",
    "/api/duplicates": "api.views.duplicates.DuplicateListView",
    "/api/duplicates/1": "api.views.duplicates.DuplicateDetailView",
    "/api/duplicates/1/delete": "api.views.duplicates.DuplicateDeleteView",
    "/api/duplicates/1/dismiss": "api.views.duplicates.DuplicateDismissView",
    "/api/duplicates/1/resolve": "api.views.duplicates.DuplicateResolveView",
    "/api/duplicates/1/revert": "api.views.duplicates.DuplicateRevertView",
    "/api/duplicates/detect": "api.views.duplicates.DetectDuplicatesView",
    "/api/duplicates/stats": "api.views.duplicates.DuplicateStatsView",
    "/api/email-config/": "api.views.email_config.EmailConfigView",
    "/api/email-config/test/": "api.views.email_config.EmailTestView",
    "/api/faces/": "api.views.faces.FaceListView get=list",
    "/api/faces/incomplete/": "api.views.faces.FaceIncompleteListViewSet get=list",
    "/api/firsttimesetup/": "api.views.user.IsFirstTimeSetupView",
    "/api/folders/subfolders/": "api.views.album_folder.FolderNavigationViewSet get=subfolders",
    "/api/fullscanphotos/": "api.views.scan_triggers.FullScanPhotosView",
    "/api/generate-captions/": "api.views.scan_triggers.GenerateCaptionsView",
    "/api/generateocr/": "api.views.scan_triggers.GenerateOcrView",
    "/api/geocode/reverse/": "api.views.geocode.GeocodeReverseView",
    "/api/geocode/search": "api.views.geocode.GeocodeSearchView",
    "/api/imagetag/": "api.views.server_info.ImageTagView",
    "/api/jobs/": "api.views.jobs.LongRunningJobViewSet get=list",
    "/api/jobs/1/": "api.views.jobs.LongRunningJobViewSet delete=destroy,get=retrieve",
    "/api/jobs/1/cancel/": "api.views.jobs.LongRunningJobViewSet post=cancel",
    "/api/labelfaces": "api.views.faces.SetFacePersonLabel",
    "/api/locationsunburst/": "api.views.dataviz.LocationSunburst",
    "/api/locationtimeline/": "api.views.dataviz.LocationTimeline",
    "/api/locclust/": "api.views.dataviz.LocationClustersView",
    "/api/manage/user/1/": "api.views.user.ManageUserViewSet patch=partial_update",
    "/api/memories": "api.views.memories.MemoriesView",
    "/api/nextcloud/listdir/": "nextcloud.views.ListDir",
    "/api/nextcloud/scanphotos/": "nextcloud.views.ScanPhotosView",
    "/api/persons/": "api.views.albums.PersonViewSet get=list",
    "/api/persons/1/": "api.views.albums.PersonViewSet delete=destroy,get=retrieve,patch=partial_update",
    "/api/photo/share": "api.views.public_photos.SetPhotoShare",
    "/api/photo/share/list": "api.views.public_photos.PhotoShareList",
    "/api/photomonthcounts/": "api.views.dataviz.PhotoMonthCountsView",
    "/api/photos/1/": "api.views.photos.PhotoViewSet delete=destroy,get=retrieve,patch=partial_update,put=update",
    "/api/photos/1/albums/": "api.views.photos.PhotoViewSet get=albums",
    "/api/photos/1/metadata": "api.views.photo_metadata.PhotoMetadataViewSet get=retrieve,patch=partial_update",
    "/api/photos/date-summary/": "api.views.photo_dates.DateSummaryView",
    "/api/photos/reapply-date-rules/": "api.views.scan_triggers.ReapplyDateRulesView",
    "/api/photos/rescan/": "api.views.scan_triggers.RescanPhotosView",
    "/api/photos/download": "api.views.zip_downloads.ZipListPhotosView_V2",
    "/api/photos/edit/1/": "api.views.photos.PhotoEditViewSet delete=destroy,get=retrieve,patch=partial_update,put=update",
    "/api/photos/metadata/bulk": "api.views.photo_metadata.BulkMetadataView",
    "/api/photos/4f1c2d3e-0000-4000-8000-000000000001/metadata/raw/": "api.views.photo_metadata.RawMetadataView",
    "/api/photos/located-nearby-in-time/": "api.views.photo_locations.LocatedNearbyInTimeView",
    "/api/photos/location-summary/": "api.views.photo_locations.LocationSummaryView",
    "/api/photos/no-album/": "api.views.photos.NoAlbumPhotoViewSet get=list",
    "/api/photos/public/": "api.views.photos.PublicPhotoListViewSet get=list",
    "/api/photos/recentlyadded/": "api.views.photos.RecentlyAddedPhotoListViewSet get=list",
    "/api/photos/searchlist/": "api.views.search.SearchListViewSet get=list",
    "/api/photos/shared/fromme/": "api.views.sharing.SharedFromMePhotoSuperSimpleListViewSet get=list",
    "/api/photos/shared/tome/": "api.views.sharing.SharedToMePhotoSuperSimpleListViewSet get=list",
    "/api/photosedit/archive/": "api.views.photos.SetPhotosArchived",
    "/api/photosedit/category/": "api.views.photos.SetPhotosCategory",
    "/api/photosedit/datetime/": "api.views.photo_dates.SetPhotosDateTimeView",
    "/api/photosedit/delete/": "api.views.photos.DeletePhotos",
    "/api/photosedit/favorite/": "api.views.photos.SetPhotosFavorite",
    "/api/photosedit/generateim2txt/": "api.views.photos.GeneratePhotoCaption",
    "/api/photosedit/hide/": "api.views.photos.SetPhotosHidden",
    "/api/photosedit/location/": "api.views.photo_locations.SetPhotosLocationView",
    "/api/photosedit/makepublic/": "api.views.photos.SetPhotosPublic",
    "/api/photosedit/rating/": "api.views.photos.SetPhotosRating",
    "/api/photosedit/rotate/": "api.views.photos.RotatePhotoView",
    "/api/photosedit/savecaption/": "api.views.photos.SavePhotoCaption",
    "/api/photosedit/setdeleted/": "api.views.photos.SetPhotosDeleted",
    "/api/photosedit/share/": "api.views.photos.SetPhotosShared",
    "/api/predefinedburstrules/": "api.views.user.PredefinedBurstRulesView",
    "/api/predefinedrules/": "api.views.user.PredefinedRulesView",
    "/api/public/albums/s/1/photos/1/": "api.views.public_albums.PublicPhotoDetailBySlug",
    "/api/restore-face-labels/": "api.views.faces.RestoreFaceLabels",
    "/api/restore-faces/": "api.views.faces.RestoreFaces",
    "/api/rqavailable/": "api.views.jobs.QueueAvailabilityView",
    "/api/scan-files/": "api.views.scan_triggers.ScanFilesView",
    "/api/scanfaces": "api.views.faces.ScanFacesView",
    "/api/scanphotos/": "api.views.scan_triggers.ScanPhotosView",
    "/api/search/metadata-values/": "api.views.search.MetadataValuesView",
    "/api/searchtermexamples/": "api.views.search.SearchTermExamples",
    "/api/serverlogs": "api.views.dataviz.ServerLogsView",
    "/api/serverlogs/view": "api.views.dataviz.ServerLogsViewerView",
    "/api/serverstats/": "api.views.dataviz.ServerStatsView",
    "/api/services/": "api.views.services.ServiceViewSet get=list",
    "/api/services/1/": "api.views.services.ServiceViewSet get=retrieve",
    "/api/sitesettings": "api.views.site_settings.SiteSettingsView",
    "/api/socialgraph/": "api.views.dataviz.SocialGraphView",
    "/api/stacks/1/": "api.views.stacks.PhotoStackDetailView",
    "/api/stacks/1/add/": "api.views.stacks.AddToStackView",
    "/api/stacks/1/primary/": "api.views.stacks.PhotoStackSetPrimaryView",
    "/api/stacks/1/remove/": "api.views.stacks.RemoveFromStackView",
    "/api/stacks/detect/": "api.views.stacks.DetectStacksView",
    "/api/stacks/manual/": "api.views.stacks.CreateManualStackView",
    "/api/stacks/merge/": "api.views.stacks.MergeStacksView",
    "/api/stacks/stats/": "api.views.stacks.PhotoStackStatsView",
    "/api/stats/": "api.views.dataviz.StatsView",
    "/api/storagestats/": "api.views.server_info.StorageStatsView",
    "/api/sync/counts/": "api.views.sync.SyncCountsView",
    "/api/tags/": "api.views.tags.TagViewSet get=list,post=create",
    "/api/tags/1/": "api.views.tags.TagViewSet delete=destroy,get=retrieve,patch=partial_update",
    "/api/tags/1/add/": "api.views.tags.TagViewSet post=add_photos",
    "/api/tags/1/merge/": "api.views.tags.TagViewSet post=merge",
    "/api/tags/1/remove/": "api.views.tags.TagViewSet post=remove_photos",
    "/api/timezones/": "api.views.timezone.TimeZoneView",
    "/api/trainfaces": "api.views.faces.TrainFaceView",
    "/api/upload/": "api.views.upload.UploadPhotosChunked",
    "/api/upload/complete/": "api.views.upload.UploadPhotosChunkedComplete",
    "/api/user/": "api.views.user.UserViewSet get=list,post=create",
    "/api/user/1/": "api.views.user.UserViewSet get=retrieve,patch=partial_update",
    "/api/useralbum/leave/": "api.views.sharing.LeaveSharedAlbum",
    "/api/useralbum/makepublic": "api.views.public_albums.SetUserAlbumPublic",
    "/api/useralbum/share/": "api.views.sharing.SetUserAlbumShared",
    "/api/wordcloud/": "api.views.dataviz.SearchTermWordCloudView",
    "/media/diagnostics/1/": "api.views.media.UnifiedMediaAccessView",
    "/media/thumbnails_big/1": "api.views.media.UnifiedMediaAccessView",
    "/media/square_thumbnails/1": "api.views.media.UnifiedMediaAccessView",
    "/media/square_thumbnails_small/1": "api.views.media.UnifiedMediaAccessView",
    "/media/photos/1.mp4": "api.views.media.UnifiedMediaAccessView",
    "/media/zip/1": "api.views.media.UnifiedMediaAccessView",
    "/media/faces/1.jpg": "api.views.media.UnifiedMediaAccessView",
    "/media/embedded_media/1": "api.views.media.UnifiedMediaAccessView",
    "/media/avatars/1.png": "api.views.media.UnifiedMediaAccessView",
    "/media/public_photo/1.jpg": "api.views.media.UnifiedMediaAccessView",
}


# Two URLs, one view, kept on purpose: #2220 documents the second name.
LEGACY_ALIASES = (("/api/scanuploadedphotos/", "/api/fullscanphotos/"),)

# A slash form the DRF router answers first, as it did before the anchoring: the
# router's photos/<pk>/ route takes /api/photos/download/. Kept as it was; a
# client writes the no-slash form, which reaches the download view.
ROUTER_SHADOWED = frozenset({"/api/photos/download/"})

# Prefixes of routes that a prefix match used to answer. Anchored, they are not found.
NOT_FOUND_PATHS = (
    "/api/stats/anything/",
    "/api/sitesettingsx/",
    "/api/serverlogs/view/more/",
    "/api/upload/unknown/",
)


def planted_view(request: HttpRequest) -> HttpResponse:
    return HttpResponse(status=404)


def describe(match: ResolverMatch) -> str:
    """The view a URL resolved to: its class (or function) and viewset actions."""
    callback = match.func
    view = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
    if view is None:
        return f"{callback.__module__}.{callback.__qualname__}"
    name = f"{view.__module__}.{view.__qualname__}"
    # DRF adds head=get to a viewset's action map once the route is built; the
    # table lists the actions the client reaches, so that implicit verb is left out.
    actions = getattr(callback, "actions", None) or {}
    shown = {m: a for m, a in actions.items() if m not in ("head", "options")}
    if shown:
        name += " " + ",".join(f"{m}={a}" for m, a in sorted(shown.items()))
    return name


def _endpoint_patterns() -> list[URLPattern]:
    """Every URL pattern of ours that is not the DRF router's own."""
    router_ids = {id(pattern) for pattern in router.urls}
    patterns: list[URLPattern] = []
    for route in [*api_routes(), *function_routes()]:
        if route.pattern is None or id(route.pattern) in router_ids:
            continue
        if route.module.split(".", 1)[0] not in OUR_PACKAGES:
            continue
        patterns.append(route.pattern)
    return patterns


def url_rule_violations(
    patterns: Iterable[URLPattern], legacy: frozenset[str] = LEGACY_RE_ROUTES
) -> list[str]:
    """What is wrong with these patterns under the naming rule, one message each."""
    problems: list[str] = []
    for pattern in patterns:
        if isinstance(pattern.pattern, RegexPattern):
            raw = str(pattern.pattern)
            if not (raw.startswith("^") and raw.endswith("$")):
                problems.append(f"{raw}: a re_path() must start with ^ and end with $")
            if raw not in legacy:
                problems.append(
                    f"{raw}: a new re_path(); write a path() with kebab-case segments"
                )
        elif isinstance(pattern.pattern, RoutePattern):
            text = str(pattern.pattern)
            if not text.endswith("/"):
                problems.append(f"{text}: a path() must end with a slash")
            for segment in text.split("/"):
                if (
                    segment
                    and "<" not in segment
                    and not KEBAB_SEGMENT.fullmatch(segment)
                ):
                    problems.append(
                        f"{text}: segment {segment!r} is not lowercase kebab case"
                    )
    return problems


class UrlPatternRuleTest(SimpleTestCase):
    def test_every_endpoint_follows_the_naming_rule(self) -> None:
        self.assertEqual(url_rule_violations(_endpoint_patterns()), [])

    def test_the_legacy_list_has_no_stale_entries(self) -> None:
        present = {
            str(pattern.pattern)
            for pattern in _endpoint_patterns()
            if isinstance(pattern.pattern, RegexPattern)
        }
        self.assertEqual(sorted(LEGACY_RE_ROUTES - present), [])

    def test_a_planted_unanchored_re_path_is_reported(self) -> None:
        problems = url_rule_violations([re_path(r"^api/newthing", planted_view)])
        self.assertTrue(
            any("must start with ^ and end with $" in p for p in problems), problems
        )
        self.assertTrue(any("a new re_path()" in p for p in problems), problems)

    def test_a_planted_camel_case_path_is_reported(self) -> None:
        problems = url_rule_violations([path("api/newThing/", planted_view)])
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("not lowercase kebab case", problems[0])

    def test_a_planted_path_without_a_slash_is_reported(self) -> None:
        problems = url_rule_violations([path("api/new-thing", planted_view)])
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("must end with a slash", problems[0])

    def test_a_conforming_path_with_converters_is_accepted(self) -> None:
        conforming = [
            path("api/new-thing/", planted_view),
            path("api/photos/<photo_key:photo_id>/new-thing/", planted_view),
            path("api/stacks/<uuid:stack_id>/new-thing/", planted_view),
        ]
        self.assertEqual(url_rule_violations(conforming), [])

    def test_photo_key_takes_a_uuid_and_an_image_hash(self) -> None:
        regex = get_converters()["photo_key"].regex
        self.assertIsNotNone(
            re.fullmatch(regex, "4f1c2d3e-0000-4000-8000-000000000001")
        )
        self.assertIsNotNone(re.fullmatch(regex, "a" * 64))
        self.assertIsNone(re.fullmatch(regex, "not-an-id!"))

    def test_client_paths_still_resolve_to_the_same_view(self) -> None:
        for url, view in CLIENT_PATHS.items():
            with self.subTest(url=url):
                self.assertEqual(describe(resolve(url)), view)

    def test_the_other_slash_form_never_reaches_a_different_view(self) -> None:
        for url, view in CLIENT_PATHS.items():
            other = url[:-1] if url.endswith("/") else url + "/"
            if other in ROUTER_SHADOWED:
                continue
            with self.subTest(url=other):
                try:
                    match = resolve(other)
                except Resolver404:
                    continue
                self.assertEqual(describe(match), view)

    def test_legacy_aliases_share_one_view(self) -> None:
        for first, second in LEGACY_ALIASES:
            with self.subTest(alias=second):
                self.assertEqual(describe(resolve(first)), describe(resolve(second)))

    def test_a_prefix_of_a_route_is_not_found(self) -> None:
        for url in NOT_FOUND_PATHS:
            with self.subTest(url=url), self.assertRaises(Resolver404):
                resolve(url)
