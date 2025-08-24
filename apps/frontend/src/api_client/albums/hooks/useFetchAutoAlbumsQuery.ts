import { useQuery } from "@tanstack/react-query";
import { FetchAutoAlbumsListResponse } from "../types";
import { fetchClient } from "../../api";

export const AutoAlbumsQueryKeys = ['autoAlbums'] as const;

const fetchAutoAlbums = () => 
    fetchClient.get('/albums/auto/list/')
      .then(response => FetchAutoAlbumsListResponse.parse(response).results);

export const useFetchAutoAlbumsQuery = () => useQuery({
        queryKey: ['autoAlbums'],
        queryFn: fetchAutoAlbums,
    });