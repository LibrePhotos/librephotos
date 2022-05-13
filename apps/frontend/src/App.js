import { AppShell, ColorSchemeProvider, MantineProvider } from "@mantine/core";
import { ConnectedRouter } from "connected-react-router";
import React, { useState } from "react";
import { Route, Switch } from "react-router-dom";
import NotificationSystem, { bootstrapTheme, dismissNotification } from "reapop";
import "semantic-ui-css/semantic.min.css";

import "./App.css";
import { FooterMenu } from "./components/menubars/Footer";
import { SideMenuNarrow } from "./components/menubars/SideMenuNarrow";
import { SideMenuNarrowPublic } from "./components/menubars/SideMenuNarrowPublic";
import { TopMenu } from "./components/menubars/TopMenu";
import { TopMenuPublic } from "./components/menubars/TopMenuPublic";
import { CountStats } from "./components/statistics";
import Login from "./containers/login";
import appHistory from "./history";
import "./i18n";
import PrivateRoute from "./layouts/PrivateRoute";
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
import { useAppDispatch, useAppSelector } from "./store/store";

const noMenubarPaths = ["/signup", "/login"];

function App() {
  const [colorScheme, setColorScheme] = useState("light");
  const toggleColorScheme = value => setColorScheme(value || (colorScheme === "dark" ? "light" : "dark"));
  const showSidebar = useAppSelector(store => store.ui.showSidebar);
  const dispatch = useAppDispatch();
  const location = useAppSelector(store => store.router.location);
  const notifications = useAppSelector(store => store.notifications);
  const auth = useAppSelector(store => store.auth);
  const showMenubar = location.pathname && !noMenubarPaths.includes(location.pathname);

  return (
    <div>
      <ConnectedRouter history={appHistory}>
        <ColorSchemeProvider colorScheme={colorScheme} toggleColorScheme={toggleColorScheme}>
          <MantineProvider theme={{ colorScheme }} withGlobalStyles withNormalizeCSS>
            <NotificationSystem
              theme={bootstrapTheme}
              dismissNotification={id => {
                dispatch(dismissNotification(id));
              }}
              notifications={notifications}
            />
            <AppShell
              fixed
              padding={0}
              navbar={
                showMenubar && showSidebar ? (
                  auth.access ? (
                    <SideMenuNarrow visible />
                  ) : (
                    <SideMenuNarrowPublic />
                  )
                ) : (
                  <div />
                )
              }
              header={showMenubar ? auth.access ? <TopMenu /> : <TopMenuPublic /> : <div />}
              footer={<FooterMenu />}
              styles={theme => ({
                main: { backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[8] : theme.colors.gray[0] },
              })}
            >
              <Switch>
                <PrivateRoute path="/" component={TimestampPhotos} exact />

                <Route path="/login" component={Login} />

                <Route path="/signup" component={SignupPage} />

                <Route path="/public/:username" component={props => <UserPublicPage {...props} />} />

                <Route path="/users" component={PublicUserList} />

                <Route path="/user/:username" component={props => <UserPublicPage {...props} />} />

                <PrivateRoute path="/things" component={AlbumThing} />

                <PrivateRoute path="/recent" component={RecentlyAddedPhotos} />

                <PrivateRoute path="/favorites" component={FavoritePhotos} />

                <PrivateRoute path="/deleted" component={DeletedPhotos} />

                <PrivateRoute path="/hidden" component={HiddenPhotos} />

                <PrivateRoute path="/notimestamp" component={NoTimestampPhotosView} />

                <PrivateRoute path="/useralbums" component={AlbumUser} />

                <PrivateRoute path="/places" component={AlbumPlace} />

                <PrivateRoute path="/people" component={AlbumPeople} />

                <PrivateRoute path="/events" component={AlbumAuto} />

                <PrivateRoute path="/statistics" component={Statistics} />

                <PrivateRoute path="/settings" component={Settings} />

                <PrivateRoute path="/profile" component={Profile} />

                <PrivateRoute path="/library" component={Library} />

                <PrivateRoute path="/faces" component={FaceDashboard} />

                <PrivateRoute path="/search" component={SearchView} />

                <PrivateRoute path="/person/:albumID" component={props => <AlbumPersonGallery {...props} />} />

                <PrivateRoute path="/place/:albumID" component={AlbumPlaceGallery} />

                <PrivateRoute path="/thing/:albumID" component={AlbumThingGallery} />

                <PrivateRoute path="/event/:albumID" component={AlbumAutoGalleryView} />

                <PrivateRoute path="/useralbum/:albumID" component={AlbumUserGallery} />

                <PrivateRoute path="/shared/tome/:which" component={SharedToMe} />
                <PrivateRoute path="/shared/fromme/:which" component={SharedFromMe} />

                <PrivateRoute path="/admin" component={AdminPage} />

                <PrivateRoute path="/map" component={PhotoMap} />
                <PrivateRoute path="/placetree" component={LocationTree} />
                <PrivateRoute path="/wordclouds" component={WordClouds} />
                <PrivateRoute path="/timeline" component={Timeline} />
                <PrivateRoute path="/socialgraph" component={Graph} />
                <PrivateRoute path="/facescatter" component={FaceScatter} />
                <PrivateRoute path="/countstats" component={CountStats} />
              </Switch>
            </AppShell>
          </MantineProvider>
        </ColorSchemeProvider>
      </ConnectedRouter>
    </div>
  );
}

export default App;
