import { FetchAutoAlbumsListResponse } from "../types";
import { fetchClient } from "../../api";
import { useQuery } from "@tanstack/react-query";

const fetchAutoAlbums = () => 
    fetchClient.get('/albums/auto/list/')
      .then(response => FetchAutoAlbumsListResponse.parse(response).results);

export const useFetchAutoAlbumsQuery = () => {
    return useQuery({
        queryKey: ['autoAlbums'],
        queryFn: fetchAutoAlbums,
    });
};