import type { ColorScheme } from "@mantine/core";
import { AppShell, ColorSchemeProvider, MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { NotificationsProvider } from "@mantine/notifications";
import React, { useState } from "react";
import { Cookies, CookiesProvider } from "react-cookie";
import { Route, Routes, useLocation } from "react-router-dom";
import "semantic-ui-css/semantic.min.css";

import "./App.css";
import { FooterMenu } from "./components/menubars/Footer";
import { SideMenuNarrow } from "./components/menubars/SideMenuNarrow";
import { SideMenuNarrowPublic } from "./components/menubars/SideMenuNarrowPublic";
import { TopMenu } from "./components/menubars/TopMenu";
import { TopMenuPublic } from "./components/menubars/TopMenuPublic";
import { CountStats } from "./components/statistics";
import { Login } from "./containers/login";
import "./i18n";
import { ProtectedRoutes } from "./layouts/PrivateRoute";
import { SearchView } from "./layouts/SearchView";
import { AlbumAuto } from "./layouts/albums/AlbumAuto";
import { AlbumAutoGalleryView } from "./layouts/albums/AlbumAutoGalleryView";
import { AlbumPeople } from "./layouts/albums/AlbumPeople";
import { AlbumPersonGallery } from "./layouts/albums/AlbumPersonGallery";
import { AlbumPlace } from "./layouts/albums/AlbumPlace";
import { AlbumPlaceGallery } from "./layouts/albums/AlbumPlaceGallery";
import { AlbumThing } from "./layouts/albums/AlbumThing";
import { AlbumThingGallery } from "./layouts/albums/AlbumThingGallery";
import { AlbumUser } from "./layouts/albums/AlbumUser";
import { AlbumUserGallery } from "./layouts/albums/AlbumUserGallery";
import { AlbumViewer } from "./layouts/albums/AlbumViewer";
import { Explorer } from "./layouts/albums/Explorer";
import { FaceScatter, Graph, LocationTree, PhotoMap, Timeline, WordClouds } from "./layouts/dataviz/DataVisualization";
import { FaceDashboard } from "./layouts/dataviz/FaceDashboard";
import { Statistics } from "./layouts/dataviz/Statistics";
import { SignupPage } from "./layouts/login/SignUpPage";
import { DeletedPhotos } from "./layouts/photos/DeletedPhotos";
import { FavoritePhotos } from "./layouts/photos/FavoritePhotos";
import { HiddenPhotos } from "./layouts/photos/HiddenPhotos";
import { NoTimestampPhotosView } from "./layouts/photos/NoTimestampPhotosView";
import { RecentlyAddedPhotos } from "./layouts/photos/RecentlyAddedPhotos";
import { TimestampPhotos } from "./layouts/photos/TimestampPhotos";
import { PublicUserList } from "./layouts/public/PublicUserList";
import { UserPublicPage } from "./layouts/public/UserPublicPage";
import { AdminPage } from "./layouts/settings/AdminPage";
import { Library } from "./layouts/settings/Library";
import { Profile } from "./layouts/settings/Profile";
import { Settings } from "./layouts/settings/Settings";
import { SharedFromMe } from "./layouts/sharing/SharedFromMe";
import { SharedToMe } from "./layouts/sharing/SharedToMe";
import { selectIsAuthenticated } from "./store/auth/authSelectors";
import { useAppSelector } from "./store/store";

const noMenubarPaths = ["/signup", "/login"];

export function App() {
  const cookies = new Cookies();
  const showSidebar = useAppSelector(store => store.ui.showSidebar);
  const isAuth = useAppSelector(selectIsAuthenticated);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(
    cookies.get("mantine-color-scheme") ? cookies.get("mantine-color-scheme") : "light"
  );

  function toggleColorScheme(value) {
    const nextColorScheme = value || (colorScheme === "dark" ? "light" : "dark");
    cookies.set("mantine-color-scheme", nextColorScheme);
    setColorScheme(nextColorScheme);
  }

  const { pathname } = useLocation();

  // @ts-ignore
  const showMenubar = pathname && !noMenubarPaths.includes(pathname);

  return (
    <CookiesProvider>
      <ColorSchemeProvider colorScheme={colorScheme} toggleColorScheme={toggleColorScheme}>
        <MantineProvider theme={{ colorScheme }} withGlobalStyles withNormalizeCSS>
          <ModalsProvider>
            <NotificationsProvider autoClose={3000} zIndex={1001}>
              <AppShell
                fixed
                padding={5}
                navbar={showMenubar && showSidebar ? isAuth ? <SideMenuNarrow /> : <SideMenuNarrowPublic /> : <div />}
                header={showMenubar ? isAuth ? <TopMenu /> : <TopMenuPublic /> : <div />}
                footer={<FooterMenu />}
                styles={theme => ({
                  main: {
                    backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[8] : theme.colors.gray[0],
                  },
                })}
              >
                <Routes>
                  <Route path="login" element={<Login />} />
                  <Route path="signup" element={<SignupPage />} />
                  <Route path="public/:username" element={<UserPublicPage />} />
                  <Route path="users" element={<PublicUserList />} />
                  <Route path="user/:username" element={<UserPublicPage />} />
                  <Route element={<ProtectedRoutes />}>
                    <Route index element={<TimestampPhotos />} />
                    <Route path="things" element={<AlbumThing />} />
                    <Route path="recent" element={<RecentlyAddedPhotos />} />
                    <Route path="favorites" element={<FavoritePhotos />} />
                    <Route path="deleted" element={<DeletedPhotos />} />
                    <Route path="hidden" element={<HiddenPhotos />} />
                    <Route path="notimestamp" element={<NoTimestampPhotosView />} />
                    <Route path="useralbums" element={<AlbumUser />} />
                    <Route path="places" element={<AlbumPlace />} />
                    <Route path="people" element={<AlbumPeople />} />
                    <Route path="events" element={<AlbumAuto />} />
                    <Route path="statistics" element={<Statistics />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="profile" element={<Profile />} />
                    <Route path="library" element={<Library />} />
                    <Route path="faces" element={<FaceDashboard />} />
                    <Route path="search" element={<SearchView />} />
                    <Route path="person/:albumID" element={<AlbumPersonGallery />} />
                    <Route path="place/:albumID" element={<AlbumPlaceGallery />} />
                    <Route path="thing/:albumID" element={<AlbumThingGallery />} />
                    <Route path="event/:albumID" element={<AlbumAutoGalleryView />} />
                    <Route path="explorer" element={<Explorer />} />
                    <Route path="albumviewer" element={<AlbumViewer />} />
                    <Route path="useralbum/:albumID" element={<AlbumUserGallery />} />
                    <Route path="shared/tome/:which" element={<SharedToMe />} />
                    <Route path="shared/fromme/:which" element={<SharedFromMe />} />
                    <Route path="admin" element={<AdminPage />} />
                    <Route path="map" element={<PhotoMap />} />
                    <Route path="placetree" element={<LocationTree />} />
                    <Route path="wordclouds" element={<WordClouds />} />
                    <Route path="timeline" element={<Timeline />} />
                    <Route path="socialgraph" element={<Graph />} />
                    <Route path="facescatter" element={<FaceScatter />} />
                    <Route path="countstats" element={<CountStats />} />
                  </Route>
                </Routes>
              </AppShell>
            </NotificationsProvider>
          </ModalsProvider>
        </MantineProvider>
      </ColorSchemeProvider>
    </CookiesProvider>
  );
}
