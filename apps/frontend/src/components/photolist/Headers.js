import React from "react";
import { Grid, GridColumn, GridRow, Header, Icon, Loader } from "semantic-ui-react";
import { TOP_MENU_HEIGHT } from "../../ui-constants";

function getDefaultHeader(photoList) {
  if (
    photoList.props.loading ||
    !photoList.props.photosGroupedByDate ||
    photoList.props.photosGroupedByDate.length < 1
  ) {
    return (
      <div>
        <div style={{ height: 60, paddingTop: 10 }}>
          <Header as="h4">
            <Header.Content>
              {photoList.props.loading ? "Loading..." : "No images found"}
              <Loader inline active={photoList.props.loading} size="mini" />
            </Header.Content>
          </Header>
        </div>

        {photoList.props.photosGroupedByDate &&
        photoList.props.photosGroupedByDate.length < 1 ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: photoList.state.height - TOP_MENU_HEIGHT - 60,
            }}
          >
            <Header>{photoList.props.noResultsMessage}</Header>
          </div>
        ) : (
          <div></div>
        )}
      </div>
    );
  }

  return (
    <Grid columns={2}>
      <GridRow>
        <GridColumn>
          <Header as="h2" style={{ paddingRight: 10 }}>
            <Icon name={photoList.props.titleIconName} />
            <Header.Content>
              {photoList.props.title}{" "}
              <Header.Subheader>
                {photoList.props.photosGroupedByDate.length !=
                photoList.props.idx2hash.length
                  ? photoList.props.photosGroupedByDate.length + " days, "
                  : ""}
                {photoList.props.idx2hash.length} photos
                {photoList.props.additionalSubHeader}
              </Header.Subheader>
            </Header.Content>
          </Header>
        </GridColumn>
        <GridColumn>
          <div
            style={{
              textAlign: "right",
              margin: "0 auto",
              padding: 20,
            }}
          >
            <span style={{ paddingLeft: 5, fontSize: 18 }}>
              <b>
                {photoList.props.dayHeaderPrefix
                  ? photoList.props.dayHeaderPrefix + photoList.props.date
                  : photoList.props.date}
                {photoList.state.fromNow}
              </b>
            </span>
          </div>
        </GridColumn>
      </GridRow>
    </Grid>
  );
}

export default getDefaultHeader;
